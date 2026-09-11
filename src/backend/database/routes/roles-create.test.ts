/**
 * Phase 86 Plan 86-02 Task 1: Tests for the widened roles-create route
 * (multipart/form-data with `data` JSON field carrying cosmetics + optional
 * avatar file part). Extends the Phase 22 test file which exercised the
 * legacy JSON-only shape.
 *
 * Tests exercise POST /roles via a bare Express app using Node's built-in
 * http module. Auth middleware is mocked. SSH primitives (connectOneShot,
 * execCommand) + resolveHostById + writeMarkdownFileAtomic are mocked.
 * `conn.sftp` is stubbed at the per-test level so the inline SFTP avatar
 * write can be asserted (target path + bytes) without spinning up ssh2.
 *
 * Coverage per Plan 86-02 Task 1 <behavior>:
 *
 *   Regression guards (mirror Phase 22 shape — still valid after widening):
 *     R-1: POST /roles without body → 400 (empty multipart data)
 *     R-2: uppercase/underscore name → 400 (ROLE_NAME_PATTERN violation)
 *     R-2b: path-traversal name (`../etc`) → 400
 *     R-3: empty description → 400
 *     R-4: cross-user hostId → 404
 *     R-5: role folder already exists → 409
 *     R-7: SSH connect failure → 502
 *     R-9: missing JWT → 401
 *
 *   Phase 86 Plan 86-02 <behavior> tests (numbered per plan):
 *     Test 1: multipart POST WITHOUT cosmetics + WITHOUT avatar → 201 with
 *       the frontmatter-less body verbatim (regression guard for the
 *       cosmetic-free path).
 *     Test 2: multipart POST with `data.cosmetics = {title, colorHue, voice}`
 *       (no avatar) → role file body BEGINS with `---\n` YAML frontmatter
 *       carrying exactly those three keys, followed by `---\n` then the
 *       standard body.
 *     Test 3: multipart POST with `data` + `avatar` (image/webp) → writes
 *       BOTH the .md (with `avatar: box-maintainer.webp` in frontmatter)
 *       AND the sibling `~/fleet/roles/box-maintainer/box-maintainer.webp`
 *       via the inline SFTP writeFile helper.
 *     Test 4: multipart POST with malformed cosmetic values (colorHue=400,
 *       voice="wrong-format") → 400 with a field-specific error message
 *       and NO writeMarkdownFileAtomic invocation.
 *     Test 5: raw JSON body (application/json instead of multipart) → 415
 *       with LOUD error "roles create requires multipart/form-data with
 *       `data` field".
 *     Test 6: avatar file exceeding 2 MiB → 413 (multer LIMIT_FILE_SIZE).
 *     Test 7: avatar file with unsupported mimetype (image/gif) → 415.
 *     Test 8: happy-path round-trip returns 201 with {name, description,
 *       cosmetics} echoing the persisted cosmetic frontmatter.
 *
 *   Belt/suspender:
 *     Test 3b: description with newlines round-trips verbatim through the
 *       frontmatter-emitting body build (guarantees the multi-line preservation
 *       property carries over from the Phase 22 shape).
 *     Test 3c: description with shell metacharacters round-trips via SFTP
 *       write unchanged (no shell injection surface).
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
// Mock SSH primitives + identity-artifact-reader helpers BEFORE importing
// module under test.
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
  // MIME_TO_AVATAR_EXT is the real map — hoisted require pattern (vi.mock
  // factory runs at module-eval time before actualImport is available).
  // Redeclare the same shape here — canonical mapping per Phase 66 Plan 01.
  MIME_TO_AVATAR_EXT: {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
  },
}));

// ROLE_NAME_PATTERN loaded via the real module (not mocked).

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// Multipart helper — mirrors identities.put-disk.test.ts buildMultipartBody
// ---------------------------------------------------------------------------

const BOUNDARY = "----vitest86-02boundary";

function buildMultipartBody(opts: {
  data: unknown;
  file?: { filename: string; contentType: string; bytes: Buffer };
}): Buffer {
  const parts: Array<Buffer | string> = [];
  parts.push(`--${BOUNDARY}\r\n`);
  parts.push(`Content-Disposition: form-data; name="data"\r\n\r\n`);
  parts.push(JSON.stringify(opts.data));
  parts.push(`\r\n`);
  if (opts.file) {
    parts.push(`--${BOUNDARY}\r\n`);
    parts.push(
      `Content-Disposition: form-data; name="avatar"; filename="${opts.file.filename}"\r\n`,
    );
    parts.push(`Content-Type: ${opts.file.contentType}\r\n\r\n`);
    parts.push(opts.file.bytes);
    parts.push(`\r\n`);
  }
  parts.push(`--${BOUNDARY}--\r\n`);
  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
}

// ---------------------------------------------------------------------------
// HTTP helpers — multipart PUT/POST + raw JSON POST for the 415 gate test
// ---------------------------------------------------------------------------

function httpPostMultipart(
  server: http.Server,
  path: string,
  body: Buffer,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpPostJson(
  server: http.Server,
  path: string,
  jsonBody: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(jsonBody),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(jsonBody);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stub SSH conn (with per-test-controllable sftp) + host record
// ---------------------------------------------------------------------------

// Captured inline SFTP writeFile calls: {path, bytes}. Reset per test.
const capturedSftpWrites: Array<{ remotePath: string; bytes: Buffer }> = [];

/** Stub `conn.sftp(cb)` returning a wrapper whose `.writeFile(remotePath,
 *  bytes, cb)` records the call to capturedSftpWrites and invokes cb(null).
 *  Also stubs `.end()`. Used to exercise the inline SFTP path added in
 *  Plan 86-02 Task 1 step 7. */
function makeStubConn(overrides?: {
  sftpError?: Error;
  writeFileError?: Error;
}) {
  return {
    end: vi.fn(),
    exec: vi.fn(),
    sftp: (cb: (err: Error | null, sftp: unknown) => void) => {
      if (overrides?.sftpError) return cb(overrides.sftpError, null);
      const sftpStub = {
        writeFile: (
          remotePath: string,
          bytes: Buffer,
          writeCb: (err: Error | null) => void,
        ) => {
          if (overrides?.writeFileError) return writeCb(overrides.writeFileError);
          capturedSftpWrites.push({ remotePath, bytes });
          writeCb(null);
        },
        end: () => { /* no-op */ },
      };
      cb(null, sftpStub);
    },
  };
}

const stubHost = {
  id: 5,
  ip: "10.0.0.5",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import the router under test
// ---------------------------------------------------------------------------

import router from "./roles-create.js";

let server: http.Server;
let stubConn: ReturnType<typeof makeStubConn>;

beforeEach(() => {
  vi.clearAllMocks();
  capturedSftpWrites.length = 0;

  stubConn = makeStubConn();

  // Default: user owns host 5; anything else → null
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 5) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default execCommand: existence probe → "missing"; echo $HOME →
  // "/home/ubuntu"; mkdir + touch → empty string.
  (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
    if (cmd.includes("if [ -d")) return "missing";
    if (cmd.includes("echo $HOME")) return "/home/ubuntu";
    if (cmd.includes("mkdir -p") || cmd.includes("touch ")) return "";
    return "";
  });

  (writeMarkdownFileAtomic as Mock).mockResolvedValue(undefined);

  const app = express();
  // Router does its own body parsing (multer + express.json fallback) — do
  // NOT mount outer json/multer here.
  app.use("/roles", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  mockUserId = "1";
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Regression guards from Phase 22 (now over multipart wire)
// ---------------------------------------------------------------------------

describe("POST /roles — regression guards (multipart form)", () => {
  it("R-1: POST /roles with empty multipart body → 400 (missing `data` field)", async () => {
    // Multipart wire with no `data` part at all — server should 400.
    const parts: Array<Buffer | string> = [
      `--${BOUNDARY}--\r\n`,
    ];
    const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
    const res = await httpPostMultipart(server, "/roles", body);
    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("R-2: uppercase/underscore name → 400 (ROLE_NAME_PATTERN violation)", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: { name: "Box_Maintainer", description: "irrelevant", hostId: 5 },
    }));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/name/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("R-2b: path-traversal role name (`../etc`) → 400", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: { name: "../etc", description: "irrelevant", hostId: 5 },
    }));
    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("R-3: empty description → 400", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: { name: "box-maintainer", description: "", hostId: 5 },
    }));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/description/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("R-4: cross-user hostId → 404 (resolveHostById returns null)", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: { name: "box-maintainer", description: "x", hostId: 99999 },
    }));
    expect(res.status).toBe(404);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("R-5: role folder already exists on host → 409", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("if [ -d")) return "exists";
      if (cmd.includes("echo $HOME")) return "/home/ubuntu";
      return "";
    });
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: { name: "box-maintainer", description: "x", hostId: 5 },
    }));
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/role exists on host/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("R-7: SSH connect failure → 502; conn NOT accessed", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 5000ms"),
    );
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: { name: "box-maintainer", description: "x", hostId: 5 },
    }));
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toMatch(/SSH connect failed/i);
    expect(stubConn.end).not.toHaveBeenCalled();
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("R-9: missing JWT → 401", async () => {
    mockUserId = null;
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: { name: "box-maintainer", description: "x", hostId: 5 },
    }));
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 86 Plan 86-02 Task 1 <behavior> tests
// ---------------------------------------------------------------------------

describe("POST /roles — Phase 86 cosmetic frontmatter + avatar sibling write", () => {
  it("Test 1: multipart POST WITHOUT cosmetics + WITHOUT avatar → 201 with frontmatter-less body verbatim (regression guard)", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: { name: "box-maintainer", description: "x", hostId: 5 },
    }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      name: "box-maintainer",
      description: "x",
      cosmetics: {},
    });

    // Assert the .md body has NO YAML frontmatter block when cosmetics absent
    // (matches the existing Phase 22 shape verbatim).
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(stubBody).not.toMatch(/^---\n/);
    expect(stubBody).toMatch(/^# box-maintainer\n\n## Role\n\nx\n/);
    // Seed comment still embedded
    expect(stubBody).toContain("This role file was auto-generated");
    expect(stubBody).toContain("remove this comment");

    // No inline SFTP avatar write happened.
    expect(capturedSftpWrites.length).toBe(0);
  });

  it("Test 2: multipart POST with cosmetics (no avatar) → body BEGINS with YAML frontmatter carrying exactly the three keys", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: "x",
        hostId: 5,
        cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Joanna" },
      },
    }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      name: "box-maintainer",
      description: "x",
      cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Joanna" },
    });

    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    // Begins with frontmatter block
    expect(stubBody.startsWith("---\n")).toBe(true);
    // Contains all three keys and no avatar (since none supplied)
    expect(stubBody).toMatch(/title:\s*Box maintainer/);
    expect(stubBody).toMatch(/colorHue:\s*190/);
    expect(stubBody).toMatch(/voice:\s*Joanna/);
    expect(stubBody).not.toMatch(/^avatar:/m);
    // Followed by closing `---\n` and the standard body
    expect(stubBody).toMatch(/---\n\n# box-maintainer\n\n## Role\n\nx\n/);

    // No inline SFTP avatar write (none supplied).
    expect(capturedSftpWrites.length).toBe(0);
  });

  it("Test 3: multipart POST with data + avatar (image/webp) → writes .md with `avatar: <name>.webp` frontmatter AND the sibling avatar file via inline SFTP writeFile", async () => {
    const avatarBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff, 0xff]); // fake WEBP header bytes
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: "x",
        hostId: 5,
        cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Joanna" },
      },
      file: {
        filename: "role-avatar.webp",
        contentType: "image/webp",
        bytes: avatarBytes,
      },
    }));

    expect(res.status).toBe(201);
    // Echoed cosmetics include avatar filename derived server-side from
    // mimetype (client filename ignored — server picks kebab-name.<ext>).
    expect(res.body).toEqual({
      name: "box-maintainer",
      description: "x",
      cosmetics: {
        title: "Box maintainer",
        colorHue: 190,
        voice: "Joanna",
        avatar: "box-maintainer.webp",
      },
    });

    // Assert .md body carries `avatar: box-maintainer.webp`
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(stubBody).toMatch(/avatar:\s*box-maintainer\.webp/);

    // Assert inline SFTP writeFile fired against the role folder sibling path
    // with the uploaded bytes.
    expect(capturedSftpWrites.length).toBe(1);
    expect(capturedSftpWrites[0].remotePath).toBe(
      "/home/ubuntu/fleet/roles/box-maintainer/box-maintainer.webp",
    );
    expect(capturedSftpWrites[0].bytes.equals(avatarBytes)).toBe(true);
  });

  it("Test 4a: malformed colorHue (400) → 400 with field-specific error, NO writeMarkdownFileAtomic", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: "x",
        hostId: 5,
        cosmetics: { colorHue: 400 },
      },
    }));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/colorHue/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 4b: malformed voice (`wrong-format`) → 400 with field-specific error, NO writeMarkdownFileAtomic", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: "x",
        hostId: 5,
        cosmetics: { voice: "wrong-format" },
      },
    }));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/voice/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 4c: malformed title (empty string) → 400 with field-specific error", async () => {
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: "x",
        hostId: 5,
        cosmetics: { title: "" },
      },
    }));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/title/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 5: raw JSON body (application/json) → 415 with LOUD error (no silent no-op)", async () => {
    const res = await httpPostJson(server, "/roles", JSON.stringify({
      name: "box-maintainer",
      description: "x",
      hostId: 5,
      cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Joanna" },
    }));

    expect(res.status).toBe(415);
    expect((res.body as { error: string }).error).toMatch(
      /multipart\/form-data/i,
    );
    expect((res.body as { error: string }).error).toMatch(/data/i);
    // Never reached provisioning
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 6: avatar file exceeding 10 MiB → 413 (multer LIMIT_FILE_SIZE)", async () => {
    // 11 MiB payload — over the 10 MiB fileSize limit (bumped from 2 MiB
    // 2026-09-11 after Phase-86 avatar cap was too tight for realistic
    // camera-photo uploads).
    const oversized = Buffer.alloc(11 * 1024 * 1024, 0xaa);
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: "x",
        hostId: 5,
        cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Joanna" },
      },
      file: {
        filename: "big.webp",
        contentType: "image/webp",
        bytes: oversized,
      },
    }));
    expect(res.status).toBe(413);
    expect((res.body as { error: string }).error).toMatch(/10 MB|10 ?MiB|limit/i);
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 7: avatar file with unsupported mimetype (image/gif) → 415", async () => {
    const bytes = Buffer.from([0x47, 0x49, 0x46, 0x38]); // "GIF8"
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: "x",
        hostId: 5,
        cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Joanna" },
      },
      file: {
        filename: "img.gif",
        contentType: "image/gif",
        bytes,
      },
    }));
    expect(res.status).toBe(415);
    // Message shape mirrors identities router's multer error handler.
    expect((res.body as { error: string }).error).toMatch(
      /PNG|JPEG|WebP|avatar/i,
    );
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 8: happy-path with cosmetics + avatar → 201 with echoed cosmetics matching persisted frontmatter", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: "A role that owns t1000",
        hostId: 5,
        cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Joanna" },
      },
      file: {
        filename: "picked.png",
        contentType: "image/png",
        bytes,
      },
    }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      name: "box-maintainer",
      description: "A role that owns t1000",
      cosmetics: {
        title: "Box maintainer",
        colorHue: 190,
        voice: "Joanna",
        avatar: "box-maintainer.png",
      },
    });

    // Persisted body's frontmatter carries the same four keys the response echoed.
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(stubBody).toMatch(/title:\s*Box maintainer/);
    expect(stubBody).toMatch(/colorHue:\s*190/);
    expect(stubBody).toMatch(/voice:\s*Joanna/);
    expect(stubBody).toMatch(/avatar:\s*box-maintainer\.png/);

    // Inline SFTP write landed at role folder with correct ext.
    expect(capturedSftpWrites.length).toBe(1);
    expect(capturedSftpWrites[0].remotePath).toBe(
      "/home/ubuntu/fleet/roles/box-maintainer/box-maintainer.png",
    );
  });

  it("Test 3b: description with newlines preserved verbatim through frontmatter-emitting body build", async () => {
    const desc = "line1\nline2\nline3";
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: desc,
        hostId: 5,
        cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Joanna" },
      },
    }));
    expect(res.status).toBe(201);
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(stubBody).toContain("## Role\n\nline1\nline2\nline3\n");
  });

  it("Test 3c: description with shell metacharacters round-trips via SFTP write unchanged (no shell injection surface)", async () => {
    const desc = "`whoami` $USER ; rm -rf / && echo 'pwned' \"quotes\"";
    const res = await httpPostMultipart(server, "/roles", buildMultipartBody({
      data: {
        name: "box-maintainer",
        description: desc,
        hostId: 5,
      },
    }));
    expect(res.status).toBe(201);
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(stubBody).toContain(desc);

    // Description must never appear inside any execCommand argument.
    const execCalls = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    for (const cmd of execCalls) {
      expect(cmd).not.toContain("whoami");
      expect(cmd).not.toContain("rm -rf");
      expect(cmd).not.toContain("pwned");
    }
  });
});
