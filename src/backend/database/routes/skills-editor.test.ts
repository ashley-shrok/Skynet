/**
 * Phase 44 (SKILLED-01): Vitest coverage for /skills-editor router.
 *
 * Byte-shape mirror of `global-files-read-write.test.ts` (Phase 23) with:
 *   - the whitelist-config mock dropped (no whitelist in Phase 44)
 *   - per-endpoint happy-path + error-path coverage for all 7 endpoints
 *   - a dedicated `describe("path-safety gate")` block with 8 SEC-labeled
 *     attack-input tests proving every escape attempt returns 400 BEFORE
 *     any SSH connection opens (RESEARCH.md § Common Pitfalls #1)
 *
 * Endpoints covered:
 *   GET  /skills-editor/skills
 *   GET  /skills-editor/files
 *   POST /skills-editor/read
 *   PUT  /skills-editor/write
 *   POST /skills-editor/create
 *   DELETE /skills-editor/file
 *   DELETE /skills-editor/skill
 *
 * Test pattern: bare Express app + Node's built-in http module (mirrors
 * roles-list-for-host.test.ts / identity-clone.test.ts patterns — no
 * supertest dependency). All SSH primitives mocked at the module boundary.
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

const { default: router } = await import("./skills-editor.js");

let server: http.Server;

/**
 * Default exec behavior: canned outputs matching a healthy 2-skill / 2-file
 * fixture. Tests override with `mockImplementation` where they want to
 * exercise a specific branch (missing HOME, mtime drift, existence
 * conflict, delete-skill guard, etc.).
 */
function defaultExecImpl(cmd: string): Promise<string> {
  if (cmd === "echo $HOME") return Promise.resolve("/home/testuser\n");
  if (cmd.startsWith("find") && cmd.includes("-maxdepth 1"))
    return Promise.resolve("build\nexplain\n");
  if (cmd.startsWith("find") && cmd.includes("-type f"))
    return Promise.resolve("SKILL.md\ntests/basic.py\n");
  if (cmd.startsWith("cat ")) return Promise.resolve("hello world");
  if (cmd.includes("stat -c '%Y'")) return Promise.resolve("1700000042");
  if (cmd.includes("stat -c '%s'")) return Promise.resolve("11");
  if (cmd.startsWith("test -e")) return Promise.resolve("ok");
  // Default: any `test -d ${skillRoot}` check assumes the skill folder
  // exists (create-endpoint skill-existence gate — post-fix for the
  // reviewer's Concern #2 about implicit skill creation).
  if (cmd.startsWith("test -d ")) return Promise.resolve("exists");
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
  app.use("/skills-editor", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
// GET /skills-editor/skills
// ===========================================================================

describe("GET /skills-editor/skills", () => {
  it("200 with { skills: [{name}...] } sorted alphabetically", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/skills?hostId=1",
    });
    expect(res.status).toBe(200);
    const body = res.body as { skills: { name: string }[] };
    expect(body.skills).toEqual([{ name: "build" }, { name: "explain" }]);
  });

  it("400 on missing hostId", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/skills",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("hostId is required");
  });

  it("400 on non-integer hostId", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/skills?hostId=abc",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe(
      "hostId must be a positive integer",
    );
  });

  it("404 on cross-user / unknown host", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/skills?hostId=999",
    });
    expect(res.status).toBe(404);
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("connect refused"));
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/skills?hostId=1",
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("SSH connect failed");
  });

  it("200 with { skills: [] } when the remote skills directory is missing", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.startsWith("find") && cmd.includes("-maxdepth 1")) return "";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/skills?hostId=1",
    });
    expect(res.status).toBe(200);
    expect((res.body as { skills: unknown[] }).skills).toEqual([]);
  });
});

// ===========================================================================
// GET /skills-editor/files
// ===========================================================================

describe("GET /skills-editor/files", () => {
  it("200 with { files: [{path}...] } sorted alphabetically, path-relative", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/files?hostId=1&skill=build",
    });
    expect(res.status).toBe(200);
    const body = res.body as { files: { path: string }[] };
    expect(body.files).toEqual([
      { path: "SKILL.md" },
      { path: "tests/basic.py" },
    ]);
  });

  it("400 on missing skill", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/files?hostId=1",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid skill name");
  });

  it("404 on cross-user / unknown host", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/files?hostId=999&skill=build",
    });
    expect(res.status).toBe(404);
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("boom"));
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/files?hostId=1&skill=build",
    });
    expect(res.status).toBe(502);
  });

  it("200 with { files: [] } when the skill has no files", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.startsWith("find") && cmd.includes("-type f")) return "";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/skills-editor/files?hostId=1&skill=build",
    });
    expect(res.status).toBe(200);
    expect((res.body as { files: unknown[] }).files).toEqual([]);
  });
});

// ===========================================================================
// POST /skills-editor/read
// ===========================================================================

describe("POST /skills-editor/read", () => {
  it("200 with { content, mtime, size, isText:true } for a text file", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "SKILL.md" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      content: string;
      mtime: number;
      size: number;
      isText: boolean;
    };
    expect(body.content).toBe("hello world");
    expect(body.mtime).toBe(1700000042);
    expect(body.size).toBe(11);
    expect(body.isText).toBe(true);
  });

  it("200 with isText:false and empty content when file contains NUL bytes", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.startsWith("cat ")) return " binary ";
        if (cmd.includes("stat -c '%Y'")) return "1700000000";
        if (cmd.includes("stat -c '%s'")) return "8";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "img.png" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { content: string; isText: boolean };
    expect(body.isText).toBe(false);
    expect(body.content).toBe("");
  });

  it("400 on invalid path (empty)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "SKILL.md" }),
    });
    expect(res.status).toBe(401);
  });

  it("404 on unknown host", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 999, skill: "build", path: "SKILL.md" }),
    });
    expect(res.status).toBe(404);
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("boom"));
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "SKILL.md" }),
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// PUT /skills-editor/write
// ===========================================================================

describe("PUT /skills-editor/write", () => {
  it("200 with { mtime } on valid write with matching expectedMtime", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "SKILL.md",
        content: "new content\n",
        expectedMtime: 1700000042,
      }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { mtime: number };
    expect(body.mtime).toBe(1700000042);
    expect((writeMarkdownFileAtomic as Mock).mock.calls).toHaveLength(1);
    const [, sftpPath, sftpContent] = (writeMarkdownFileAtomic as Mock).mock
      .calls[0] as [unknown, string, string];
    expect(sftpPath).toBe("/home/testuser/.claude/skills/build/SKILL.md");
    expect(sftpContent).toBe("new content\n");
  });

  it("409 with byte-identical Phase 23 mtime-mismatch shape on drift", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("stat -c '%Y'")) return "1700000999";
        if (cmd.startsWith("cat ")) return "actual disk content\n";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "SKILL.md",
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
    expect(body.currentContent).toBe("actual disk content\n");
    // 409 short-circuits BEFORE writeMarkdownFileAtomic runs.
    expect((writeMarkdownFileAtomic as Mock).mock.calls).toHaveLength(0);
  });

  it("400 when content exceeds MAX_CONTENT_BYTES (2 MB)", async () => {
    const oversized = "x".repeat(2_000_001);
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "SKILL.md",
        content: oversized,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("400 on invalid path", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "../etc/passwd",
        content: "x",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("502 when writeMarkdownFileAtomic fails", async () => {
    (writeMarkdownFileAtomic as Mock).mockRejectedValueOnce(
      new Error("sftp broken"),
    );
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "SKILL.md",
        content: "new content",
      }),
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// POST /skills-editor/create
// ===========================================================================

describe("POST /skills-editor/create", () => {
  it("200 with { path, mtime } on new file", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/create",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "new-file.md" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { path: string; mtime: number };
    expect(body.path).toBe("new-file.md");
    expect(body.mtime).toBe(1700000042);
    // Verify mkdir -p ran on the parent, then touch on the file.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const mkdirCall = calls.find(([, cmd]) => cmd.startsWith("mkdir -p"));
    expect(mkdirCall).toBeDefined();
    const touchCall = calls.find(([, cmd]) => cmd.startsWith("touch "));
    expect(touchCall).toBeDefined();
    expect(touchCall![1]).toContain(
      "'/home/testuser/.claude/skills/build/new-file.md'",
    );
  });

  it("409 with { error: 'file exists' } when target already exists", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.startsWith("test -e")) return "exists";
        return defaultExecImpl(cmd);
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/create",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "SKILL.md" }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe("file exists");
    // Should NOT have called touch after the 409.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const touchCall = calls.find(([, cmd]) => cmd.startsWith("touch "));
    expect(touchCall).toBeUndefined();
  });

  it("400 on invalid skill name", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/create",
      body: JSON.stringify({ hostId: 1, skill: "bad name", path: "x.md" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 with { error: 'skill not found' } when the skill folder is missing (no implicit scaffolding)", async () => {
    // Reviewer's Concern #2: without the skill-existence gate, `mkdir -p`
    // silently creates the whole skill folder from thin air, violating the
    // shape's "Creating a brand-new skill from scratch is out of scope" OUT.
    // This test proves the gate refuses and no touch/mkdir on the skill root fires.
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        // Skill folder does NOT exist.
        if (cmd.startsWith("test -d ")) return "missing";
        return defaultExecImpl(cmd);
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/create",
      body: JSON.stringify({ hostId: 1, skill: "novel-skill", path: "hi.md" }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("skill not found");
    // Critical: no mkdir or touch fired after the 404 — no skill materialized.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    expect(calls.find(([, c]) => c.startsWith("mkdir -p"))).toBeUndefined();
    expect(calls.find(([, c]) => c.startsWith("touch "))).toBeUndefined();
  });
});

// ===========================================================================
// DELETE /skills-editor/file
// ===========================================================================

describe("DELETE /skills-editor/file", () => {
  it("200 with { ok:true } on valid input", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/file",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "SKILL.md",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmCall = calls.find(([, cmd]) => cmd.startsWith("rm -f "));
    expect(rmCall).toBeDefined();
    expect(rmCall![1]).toContain(
      "'/home/testuser/.claude/skills/build/SKILL.md'",
    );
  });

  it("400 on invalid path", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/file",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "../etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("404 on unknown host", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/file",
      body: JSON.stringify({
        hostId: 999,
        skill: "build",
        path: "SKILL.md",
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// DELETE /skills-editor/skill
// ===========================================================================

describe("DELETE /skills-editor/skill", () => {
  it("200 with { ok:true } on valid skill; rm -rf against composed skillRoot", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "build" }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf "));
    expect(rmrfCall).toBeDefined();
    expect(rmrfCall![1]).toContain("'/home/testuser/.claude/skills/build'");
  });

  it("400 on invalid skill '../etc' BEFORE any rm -rf runs", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "../etc" }),
    });
    expect(res.status).toBe(400);
    // rm -rf must NEVER have been called.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf"));
    expect(rmrfCall).toBeUndefined();
    // SSH must NEVER have opened (validation runs before resolveHostById).
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("404 on unknown host", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 999, skill: "build" }),
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// Path-safety gate — dedicated attack-input coverage (RESEARCH.md § Pitfall 1)
// ===========================================================================

describe("path-safety gate", () => {
  it("SEC-1: rejects skill '..' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 1, skill: "..", path: "SKILL.md" }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
    expect((execCommand as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-2: rejects skill '../etc' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 1, skill: "../etc", path: "SKILL.md" }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-3: rejects skill 'foo/bar' (embedded slash) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({ hostId: 1, skill: "foo/bar", path: "SKILL.md" }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-4: rejects path '../../etc/passwd' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "../../etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-5: rejects path '/etc/passwd' (leading slash) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "/etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-6: rejects path 'foo\\0.txt' (NUL byte) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "foo .txt",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-7: rejects path 'foo/../bar' (embedded '..' segment) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        skill: "build",
        path: "foo/../bar",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-8: rejects DELETE /skill on skill '..' (life-critical rm -rf guard)", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: ".." }),
    });
    expect(res.status).toBe(400);
    // The whole point: rm -rf must NEVER have been dispatched.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf"));
    expect(rmrfCall).toBeUndefined();
    // SSH must NEVER have opened either.
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });
});
