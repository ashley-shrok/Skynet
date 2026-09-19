/**
 * workspace-routes.test.ts (Phase 118, Plan 118-01, Task 2)
 *
 * Vitest suite covering the 9-endpoint workspace CRUD router:
 *   POST /workspace/list, /read-file, /rename, /mkdir, /create-file, /upload
 *   PUT  /workspace/write-file
 *   DELETE /workspace/entry
 *   GET  /workspace/download
 *
 * Security gates covered:
 *   - Auth: no JWT → 401
 *   - Permission: canAccessHost false → 403 permission_denied
 *   - Path traversal (static pre-SFTP check): relativePath "../../etc" → 400 path_traversal
 *   - identityKey injection: "../../etc" → 400 invalid_identity_key
 *   - resolveHostById null → 404 unknown_host
 *   - Post-realpath symlink escape: sftp.realpath returns "/etc/passwd" → 400 path_traversal
 *   - SFTP ENOENT error → 404 not_found (T-40-05: body never contains "ENOENT" substring)
 *   - T-40-05 info-leak invariant: response body is exactly { error: "<class>" }
 *   - DELETE: stat=directory → sftp.rmdir called; ENOTEMPTY (code 4) → 409 not_empty
 *   - PUT /write-file: createWriteStream called with tempPath ending in ".partial" then rename
 *   - POST /upload: multer memoryStorage, no .skynet-export.sqlite filter
 *   - Permission action: list uses "read", write-file uses "write"
 *
 * Mock scaffolding mirrors pretty-view-fetch-host-file.test.ts:
 *   - Bare Express app + Node http module + vi.mock for 5 modules
 *   - resolveHostById (NOT resolveHostByName) — workspace uses numeric hostId
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

/* --------------------------------------------------------------------- */
/*  Auth mock — allow/deny via mockUserId                                */
/* --------------------------------------------------------------------- */

let mockUserId: string | null = "user-A";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
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

/* --------------------------------------------------------------------- */
/*  Permission manager mock — canAccessHost                              */
/* --------------------------------------------------------------------- */

let mockCanAccessHost: (
  userId: string,
  hostId: number,
  action: string,
) => Promise<{ hasAccess: boolean }> = async () => ({ hasAccess: true });

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: (userId: string, hostId: number, action: string) =>
        mockCanAccessHost(userId, hostId, action),
    }),
  },
}));

/* --------------------------------------------------------------------- */
/*  Logger mock                                                          */
/* --------------------------------------------------------------------- */

vi.mock("../../utils/logger.js", () => ({
  sshLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

/* --------------------------------------------------------------------- */
/*  Host resolver mock — resolveHostById (NOT resolveHostByName)        */
/* --------------------------------------------------------------------- */

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

/* --------------------------------------------------------------------- */
/*  SSH connection pool + one-shot mocks                                 */
/* --------------------------------------------------------------------- */

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(async () => stubClient),
}));

/**
 * Stub SFTP + client — extended for workspace CRUD operations.
 * All methods are vi.fn() so tests can assert call counts and arguments.
 */
interface StubSftp {
  realpath: Mock;
  stat: Mock;
  readFile: Mock;
  readdir: Mock;
  writeFile: Mock;
  mkdir: Mock;
  unlink: Mock;
  rmdir: Mock;
  rename: Mock;
  createWriteStream: Mock;
}

interface StubClient {
  sftp: Mock;
}

let stubSftp: StubSftp;
let stubClient: StubClient;

/**
 * Default createWriteStream mock: returns a WriteStream-like object
 * where .end() triggers 'close' via queueMicrotask. Rename succeeds by default.
 */
function makeDefaultWriteStream() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    write: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        if (handlers["close"]) {
          handlers["close"].forEach((h) => h());
        }
      });
    }),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(cb);
    }),
  };
}

function resetStubClient() {
  const fakeWriteStream = makeDefaultWriteStream();
  stubSftp = {
    realpath: vi.fn(
      (p: string, cb: (err: Error | null, resolved: string) => void) => {
        queueMicrotask(() => cb(null, p));
      },
    ),
    stat: vi.fn(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: {
            size: number;
            isFile: () => boolean;
            isDirectory: () => boolean;
          },
        ) => void,
      ) => {
        queueMicrotask(() =>
          cb(null, {
            size: 5,
            isFile: () => true,
            isDirectory: () => false,
          }),
        );
      },
    ),
    readFile: vi.fn(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() => cb(null, Buffer.from("hello", "utf8")));
      },
    ),
    readdir: vi.fn(
      (_p: string, cb: (err: Error | null, list: unknown[]) => void) => {
        queueMicrotask(() =>
          cb(null, [
            {
              filename: "test.txt",
              attrs: {
                size: 100,
                mtime: 1700000000,
                mode: 0o100644,
                isFile: () => true,
                isDirectory: () => false,
                isSymbolicLink: () => false,
              },
            },
          ]),
        );
      },
    ),
    writeFile: vi.fn((_p: string, _data: Buffer, cb: (err: Error | null) => void) => {
      queueMicrotask(() => cb(null));
    }),
    mkdir: vi.fn((_p: string, cb: (err: Error | null) => void) => {
      queueMicrotask(() => cb(null));
    }),
    unlink: vi.fn((_p: string, cb: (err: Error | null) => void) => {
      queueMicrotask(() => cb(null));
    }),
    rmdir: vi.fn((_p: string, cb: (err: Error | null) => void) => {
      queueMicrotask(() => cb(null));
    }),
    rename: vi.fn(
      (_from: string, _to: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(null));
      },
    ),
    createWriteStream: vi.fn(() => fakeWriteStream),
  };

  stubClient = {
    sftp: vi.fn((cb: (err: Error | null, sftp: StubSftp) => void) => {
      queueMicrotask(() => cb(null, stubSftp));
    }),
  };
}

vi.mock("../../ssh/ssh-connection-pool.js", () => ({
  withConnection: vi.fn(
    async (
      _key: string,
      factory: () => Promise<StubClient>,
      fn: (client: StubClient) => Promise<unknown>,
    ) => {
      const client = await factory();
      return fn(client);
    },
  ),
}));

/* --------------------------------------------------------------------- */
/*  Import module under test AFTER all vi.mock declarations              */
/* --------------------------------------------------------------------- */

import { resolveHostById } from "../../ssh/host-resolver.js";

const { workspaceRoutes } = await import("./workspace-routes.js");

/* --------------------------------------------------------------------- */
/*  HTTP helpers                                                         */
/* --------------------------------------------------------------------- */

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{
  status: number;
  body: unknown;
  rawBody: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) {
      headers["Content-Type"] =
        headers["Content-Type"] ?? "application/json";
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
          resolve({
            status: res.statusCode ?? 0,
            body,
            rawBody: data,
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/**
 * Hand-built multipart/form-data body — avoids adding a supertest dependency.
 * Follows RFC 7578 for basic field + file part.
 */
function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  fileField: string,
  fileBuffer: Buffer,
  filename: string,
): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

/* --------------------------------------------------------------------- */
/*  Fixture host + mount setup                                           */
/* --------------------------------------------------------------------- */

const fixtureHost = {
  id: 42,
  name: "echo-box",
  userId: "user-A",
  ip: "100.101.1.1",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "user-A";
  mockCanAccessHost = async () => ({ hasAccess: true });
  resetStubClient();
  (resolveHostById as Mock).mockImplementation(
    async (hostId: number, _userId: string) => {
      if (hostId === 42) return fixtureHost;
      return null;
    },
  );

  // Mount workspaceRoutes exactly as database.ts does
  const app = express();
  app.use("/workspace", workspaceRoutes);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

/* --------------------------------------------------------------------- */
/*  Test 1: POST /workspace/list success → 200 { entries, path }        */
/* --------------------------------------------------------------------- */

describe("POST /workspace/list", () => {
  it("Test 1: valid auth + stub readdir → 200 { entries, path }", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 42, relativePath: "" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { entries: unknown[]; path: string };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries).toHaveLength(1);
    expect(body.path).toBe("");
    expect((body.entries[0] as { name: string }).name).toBe("test.txt");
  });

  it("Test 2: no auth (mockUserId = null) → 401 Unauthorized", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 42 }),
    });
    expect(res.status).toBe(401);
    // Verify sftp was never opened
    expect(stubSftp.realpath).not.toHaveBeenCalled();
  });

  it("Test 3: canAccessHost false → 403 permission_denied", async () => {
    mockCanAccessHost = async () => ({ hasAccess: false });
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 42 }),
    });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe("permission_denied");
    // Verify sftp was never opened
    expect(stubSftp.readdir).not.toHaveBeenCalled();
  });

  it("Test 4: relativePath '../../etc' → 400 path_traversal; sftp.readdir NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 42, relativePath: "../../etc" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("path_traversal");
    expect(stubSftp.readdir).not.toHaveBeenCalled();
  });

  it("Test 5: identityKey '../../etc' → 400 invalid_identity_key; resolveHostById NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "../../etc", hostId: 42 }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_identity_key");
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("Test 6: resolveHostById returns null → 404 unknown_host", async () => {
    (resolveHostById as Mock).mockResolvedValue(null);
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 999 }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("unknown_host");
  });

  it("Test 7 (T-40-05): sftp.readdir ENOENT → 404 not_found; body has NO ENOENT substring, NO absolutePath, NO stack", async () => {
    stubSftp.readdir.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() =>
          cb(new Error("ENOENT no such file or directory")),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 42 }),
    });
    expect(res.status).toBe(404);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("ENOENT");
    expect(raw).not.toContain("/fleet/");
    expect(raw).not.toContain("stack");
    // T-40-05: body must be exactly { error: "<class>" }
    expect(Object.keys(res.body as object)).toEqual(["error"]);
    expect((res.body as { error: string }).error).toBe("not_found");
  });

  it("Test 8: post-realpath symlink escape (realpath returns /etc/passwd) → 400 path_traversal; sftp.readdir NOT called", async () => {
    // First realpath call (for ".") returns home dir; subsequent calls for workspace path return /etc/passwd
    let realpathCallCount = 0;
    stubSftp.realpath.mockImplementation(
      (p: string, cb: (err: Error | null, resolved: string) => void) => {
        realpathCallCount++;
        if (realpathCallCount === 1) {
          // First call: sftpRealpath(sftp, ".") → home dir
          queueMicrotask(() => cb(null, "/home/ubuntu"));
        } else {
          // Second call: sftpRealpath(sftp, absolutePath) → symlink escape
          queueMicrotask(() => cb(null, "/etc/passwd"));
        }
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 42, relativePath: "nasty-link" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("path_traversal");
    expect(stubSftp.readdir).not.toHaveBeenCalled();
  });

  it("Test 13a: canAccessHost called with action 'read' for list", async () => {
    let capturedAction = "";
    mockCanAccessHost = async (_uid: string, _hid: number, action: string) => {
      capturedAction = action;
      return { hasAccess: true };
    };
    await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 42 }),
    });
    expect(capturedAction).toBe("read");
  });
});

/* --------------------------------------------------------------------- */
/*  Test 9: PUT /workspace/write-file — atomic write                     */
/* --------------------------------------------------------------------- */

describe("PUT /workspace/write-file", () => {
  it("Test 9: valid body → 200; createWriteStream called with path ending '.partial', then rename called", async () => {
    let capturedTempPath = "";
    let capturedRenameSrc = "";

    stubSftp.createWriteStream.mockImplementation((p: string, _opts?: unknown) => {
      capturedTempPath = p;
      return makeDefaultWriteStream();
    });
    stubSftp.rename.mockImplementation(
      (from: string, _to: string, cb: (err: Error | null) => void) => {
        capturedRenameSrc = from;
        queueMicrotask(() => cb(null));
      },
    );

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/workspace/write-file",
      body: JSON.stringify({
        identityKey: "echo",
        hostId: 42,
        relativePath: "notes.txt",
        content: "hello world",
      }),
    });
    expect(res.status).toBe(200);
    expect(capturedTempPath).toContain(".partial");
    expect(capturedRenameSrc).toContain(".partial");
  });

  it("Test 13b: canAccessHost called with action 'write' for write-file", async () => {
    let capturedAction = "";
    mockCanAccessHost = async (_uid: string, _hid: number, action: string) => {
      capturedAction = action;
      return { hasAccess: true };
    };
    await httpRequest(server, {
      method: "PUT",
      path: "/workspace/write-file",
      body: JSON.stringify({
        identityKey: "echo",
        hostId: 42,
        relativePath: "notes.txt",
        content: "test",
      }),
    });
    expect(capturedAction).toBe("write");
  });
});

/* --------------------------------------------------------------------- */
/*  Test 10: DELETE /workspace/entry — directory vs file + ENOTEMPTY    */
/* --------------------------------------------------------------------- */

describe("DELETE /workspace/entry", () => {
  it("Test 10a: stat returns isDirectory=true → sftp.rmdir called (not unlink)", async () => {
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: {
            size: number;
            isFile: () => boolean;
            isDirectory: () => boolean;
          },
        ) => void,
      ) => {
        queueMicrotask(() =>
          cb(null, {
            size: 0,
            isFile: () => false,
            isDirectory: () => true,
          }),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/workspace/entry",
      body: JSON.stringify({ identityKey: "echo", hostId: 42, relativePath: "mydir" }),
    });
    expect(res.status).toBe(200);
    expect(stubSftp.rmdir).toHaveBeenCalled();
    expect(stubSftp.unlink).not.toHaveBeenCalled();
  });

  it("Test 10b: rmdir errors with code 4 (SSH_FX_FAILURE / ENOTEMPTY) → 409 not_empty", async () => {
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: {
            size: number;
            isFile: () => boolean;
            isDirectory: () => boolean;
          },
        ) => void,
      ) => {
        queueMicrotask(() =>
          cb(null, {
            size: 0,
            isFile: () => false,
            isDirectory: () => true,
          }),
        );
      },
    );
    stubSftp.rmdir.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        const err = new Error("Directory not empty");
        (err as Error & { code?: number }).code = 4; // SSH_FX_FAILURE
        queueMicrotask(() => cb(err));
      },
    );
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/workspace/entry",
      body: JSON.stringify({ identityKey: "echo", hostId: 42, relativePath: "nonempty-dir" }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe("not_empty");
    // T-40-05: body must be exactly { error: "<class>" }
    expect(Object.keys(res.body as object)).toEqual(["error"]);
  });

  it("Test 10c: stat returns isFile=true → sftp.unlink called (not rmdir)", async () => {
    // Default stub has isFile=true
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/workspace/entry",
      body: JSON.stringify({ identityKey: "echo", hostId: 42, relativePath: "file.txt" }),
    });
    expect(res.status).toBe(200);
    expect(stubSftp.unlink).toHaveBeenCalled();
    expect(stubSftp.rmdir).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------------- */
/*  Test 11: POST /workspace/rename                                      */
/* --------------------------------------------------------------------- */

describe("POST /workspace/rename", () => {
  it("Test 11: valid from and to → sftp.rename called with resolved absolute paths", async () => {
    let capturedRenameFrom = "";
    let capturedRenameTo = "";
    stubSftp.rename.mockImplementation(
      (from: string, to: string, cb: (err: Error | null) => void) => {
        capturedRenameFrom = from;
        capturedRenameTo = to;
        queueMicrotask(() => cb(null));
      },
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/rename",
      body: JSON.stringify({
        identityKey: "echo",
        hostId: 42,
        from: "old-name.txt",
        to: "new-name.txt",
      }),
    });
    expect(res.status).toBe(200);
    expect(capturedRenameFrom).toContain("old-name.txt");
    expect(capturedRenameTo).toContain("new-name.txt");
    expect(capturedRenameFrom).toContain("/workspace/");
  });

  it("Test 11b: traversal in 'from' → 400 path_traversal", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/rename",
      body: JSON.stringify({
        identityKey: "echo",
        hostId: 42,
        from: "../../etc/passwd",
        to: "safe.txt",
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("path_traversal");
    expect(stubSftp.rename).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------------- */
/*  Test 12: POST /workspace/upload — multer memoryStorage              */
/* --------------------------------------------------------------------- */

describe("POST /workspace/upload", () => {
  it("Test 12: multipart upload with buffer → 200; createWriteStream called; no .skynet-export.sqlite filter", async () => {
    const boundary = "----FormBoundary12345";
    const fileBuffer = Buffer.from("file contents here", "utf8");
    const body = buildMultipart(
      boundary,
      {
        identityKey: "echo",
        hostId: "42",
        relativePath: "uploaded.txt",
      },
      "file",
      fileBuffer,
      "uploaded.txt",
    );

    const res = await new Promise<{
      status: number;
      body: unknown;
    }>((resolve, reject) => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method: "POST",
          path: "/workspace/upload",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": String(body.byteLength),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    expect(res.status).toBe(200);
    expect(stubSftp.createWriteStream).toHaveBeenCalled();
    // The createWriteStream call should have a path (not the .skynet-export.sqlite filter)
    const callArg = (stubSftp.createWriteStream as Mock).mock.calls[0]?.[0] as string;
    expect(typeof callArg).toBe("string");
    expect(callArg).toContain(".partial");
  });

  it("Test 12b: upload with invalid identityKey → 400 invalid_identity_key; no SFTP call", async () => {
    const boundary = "----FormBoundaryBad";
    const fileBuffer = Buffer.from("x", "utf8");
    const body = buildMultipart(
      boundary,
      {
        identityKey: "../../etc",
        hostId: "42",
        relativePath: "bad.txt",
      },
      "file",
      fileBuffer,
      "bad.txt",
    );

    const res = await new Promise<{
      status: number;
      body: unknown;
    }>((resolve, reject) => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method: "POST",
          path: "/workspace/upload",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": String(body.byteLength),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
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

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_identity_key");
    expect(stubSftp.createWriteStream).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------------- */
/*  Test: GET /workspace/download                                        */
/* --------------------------------------------------------------------- */

describe("GET /workspace/download", () => {
  it("Test 14: valid query → 200 with Content-Disposition attachment", async () => {
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() => cb(null, Buffer.from("binary data", "utf8")));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/workspace/download?identityKey=echo&hostId=42&relativePath=notes.txt",
    });
    expect(res.status).toBe(200);
    const cd = res.headers["content-disposition"] as string;
    expect(cd).toContain("attachment");
    expect(cd).toContain("notes.txt");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("Test 14b: traversal in relativePath via query → 400 path_traversal", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/workspace/download?identityKey=echo&hostId=42&relativePath=../../etc/passwd",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("path_traversal");
  });
});

/* --------------------------------------------------------------------- */
/*  Test: POST /workspace/mkdir                                          */
/* --------------------------------------------------------------------- */

describe("POST /workspace/mkdir", () => {
  it("Test 15: valid mkdir → 200; sftp.mkdir called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/mkdir",
      body: JSON.stringify({ identityKey: "echo", hostId: 42, relativePath: "new-folder" }),
    });
    expect(res.status).toBe(200);
    expect(stubSftp.mkdir).toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------------- */
/*  Test: POST /workspace/create-file                                    */
/* --------------------------------------------------------------------- */

describe("POST /workspace/create-file", () => {
  it("Test 16: valid create-file → 200; createWriteStream called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/create-file",
      body: JSON.stringify({ identityKey: "echo", hostId: 42, relativePath: "newfile.txt" }),
    });
    expect(res.status).toBe(200);
    expect(stubSftp.createWriteStream).toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------------- */
/*  Test: T-40-05 info-leak invariant — response bodies on error paths   */
/* --------------------------------------------------------------------- */

describe("T-40-05 info-leak invariant", () => {
  it("Test 7b: SFTP error body is exactly { error: '<class>' } — no err.message leak", async () => {
    stubSftp.readdir.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() =>
          cb(new Error("EACCES: Permission denied /very/secret/path/token-key.txt")),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/workspace/list",
      body: JSON.stringify({ identityKey: "echo", hostId: 42 }),
    });
    expect(res.status).toBe(403);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("EACCES");
    expect(raw).not.toContain("token-key.txt");
    expect(raw).not.toContain("/very/secret/");
    // T-40-05: body must be exactly { error: "<class>" }
    expect(Object.keys(res.body as object)).toEqual(["error"]);
    const errStr = (res.body as { error: string }).error;
    // error is a single token (no colon separator) — not "class: details"
    expect(errStr.split(":")).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------- */
/*  Test: multer memoryStorage — confirms dedicated instance behavior    */
/* --------------------------------------------------------------------- */

describe("Multer memoryStorage (Pitfall 6)", () => {
  it("Test 12c: upload accepts arbitrary file extension (not .skynet-export.sqlite filter)", async () => {
    const boundary = "----AnyFileBoundary";
    const fileBuffer = Buffer.from("arbitrary binary content", "utf8");
    const body = buildMultipart(
      boundary,
      {
        identityKey: "echo",
        hostId: "42",
        relativePath: "image.png",
      },
      "file",
      fileBuffer,
      "image.png",
    );

    const res = await new Promise<{ status: number; body: unknown }>(
      (resolve, reject) => {
        const { port } = server.address() as AddressInfo;
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            method: "POST",
            path: "/workspace/upload",
            headers: {
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Content-Length": String(body.byteLength),
            },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
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
      },
    );

    // Should NOT be rejected by a .skynet-export.sqlite filter — should proceed to SFTP
    expect(res.status).toBe(200);
    expect(stubSftp.createWriteStream).toHaveBeenCalled();
  });
});
