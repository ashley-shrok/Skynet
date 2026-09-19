/**
 * pretty-view-fetch-host-file.test.ts (Phase 75, Plan 75-01, Task 2)
 *
 * Vitest suite covering the split-router shape:
 *   - `prettyViewFetchHostFileRoutes` (POST-only, mounted at `/pretty-view`)
 *   - `fileUrlRoutes`                 (GET-only,  mounted at `/`)
 *
 * Both routers share a private `fetchHostFileBytes(userId, hostname,
 * absolutePath)` helper that owns ALL auth + resolve + guardrails + realpath +
 * stat + read logic. The T-78-07 symlink defense is enforced by calling
 * `sftp.realpath(absolutePath)` BEFORE `sftp.stat` and re-checking the
 * resolved target against the FORBIDDEN_PATH_RE regex.
 *
 * Ghost-alias absence (W-3): the POST-only router has no GET handler, and the
 * GET-only router has no POST handler — so `POST /fetch-host-file` at root
 * and `GET /pretty-view/file/:host/*` both return 404 by construction. Source-
 * level grep gates in the plan's acceptance-criteria confirm this at the
 * export level; here we assert it at the wiring level by mounting both
 * routers as the real database.ts will and hitting the ghost URLs.
 *
 * XSS defense (T-78-01-GET1, reshaped): the GET handler dispatches
 * content-type per file extension into three lanes — inline media
 * (video/audio/image/pdf), attachment (html/js/svg/xhtml — forces download
 * rather than in-tab render), and as-is text (source code, configs). Test
 * 26 hits a `.html` file and asserts `Content-Disposition: attachment` so
 * the browser downloads rather than executes. Test 34 confirms
 * `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` on error
 * responses. Test 25 confirms sniff-fallback for unknown-extension text
 * files.
 *
 * Info-leak invariant (T-40-05): NEVER include `err.message`, `absolutePath`,
 * or `filename` in ANY response body (JSON or raw send). Tests 16 + 33
 * enforce this across POST and GET catch branches.
 *
 * Mock scaffolding pattern mirrors `global-files-read-write.test.ts` — bare
 * Express app + Node http module + vi.mock for auth/host-resolver/permission
 * /pool/sftp primitives.
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
import { Readable } from "node:stream";

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
/*  Host resolver mock — resolveHostByName                               */
/* --------------------------------------------------------------------- */

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostByName: vi.fn(),
}));

/* --------------------------------------------------------------------- */
/*  SSH connection pool + one-shot mocks                                 */
/*                                                                       */
/*  withConnection(key, factory, fn) — invokes fn(client) and returns    */
/*  the result. Our client is a stub with the .sftp() shape the SFTP    */
/*  helpers duck-type against.                                           */
/* --------------------------------------------------------------------- */

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(async () => stubClient),
}));

/**
 * Stub client + SFTP with per-test-overridable behaviour. Every call is a
 * vi.fn so tests can assert whether specific calls were / were NOT made
 * (critical for the T-78-07 defense assertion: realpath called, stat NOT
 * called).
 */
interface StubSftp {
  realpath: Mock;
  stat: Mock;
  readFile: Mock;
  createReadStream: Mock;
}

interface StubClient {
  sftp: Mock;
}

let stubSftp: StubSftp;
let stubClient: StubClient;

/**
 * Test-only helper: run the current `stubSftp.readFile` mock and return
 * the buffer it delivers. Both readFile and the default createReadStream
 * draw from this so per-test `readFile.mockImplementation(...)` overrides
 * transparently drive stream content too — no per-test duplication.
 */
function readStubFileBytes(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    stubSftp.readFile("_", (err: Error | null, data: Buffer) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

function resetStubClient() {
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
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 5, isFile: () => true }));
      },
    ),
    readFile: vi.fn((_p: string, cb: (err: Error | null, data: Buffer) => void) => {
      queueMicrotask(() => cb(null, Buffer.from("hello", "utf8")));
    }),
    // Default: build a Readable over the same bytes that readFile would
    // deliver, sliced by {start,end}. Tests that override readFile
    // implicitly override stream content too.
    createReadStream: vi.fn(
      (_p: string, options?: { start?: number; end?: number }) => {
        const readable = new Readable({ read() {} });
        readStubFileBytes()
          .then((buf) => {
            const start = options?.start ?? 0;
            const end = options?.end ?? buf.length - 1;
            const slice = buf.subarray(start, end + 1);
            queueMicrotask(() => {
              if (slice.length > 0) readable.push(slice);
              readable.push(null);
            });
          })
          .catch((err) => {
            queueMicrotask(() => readable.destroy(err));
          });
        return readable;
      },
    ),
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

import { resolveHostByName } from "../../ssh/host-resolver.js";
const { prettyViewFetchHostFileRoutes, fileUrlRoutes } = await import(
  "./pretty-view-fetch-host-file.js"
);

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

/* --------------------------------------------------------------------- */
/*  Fixture host + mount setup                                           */
/* --------------------------------------------------------------------- */

const fixtureHost = {
  id: 42,
  name: "thenasty",
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
  (resolveHostByName as Mock).mockImplementation(
    async (name: string, _userId: string) => {
      if (name === "thenasty") return fixtureHost;
      return null;
    },
  );

  // Mount BOTH routers exactly as database.ts does — POST-only at
  // /pretty-view, GET-only at /. This lets us hit the ghost-alias URLs
  // and assert 404 by construction.
  const app = express();
  app.use("/pretty-view", prettyViewFetchHostFileRoutes);
  app.use("/", fileUrlRoutes);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

/* --------------------------------------------------------------------- */
/*  POST /pretty-view/fetch-host-file tests (Tests 1-17)                 */
/* --------------------------------------------------------------------- */

describe("POST /pretty-view/fetch-host-file — modal JSON path", () => {
  it("Test 1: missing/invalid body → 400 invalid_body", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_body");
  });

  it("Test 2: invalid hostname → 400 invalid_hostname", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({ hostname: "bad hostname!", absolutePath: "/etc/hostname" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_hostname");
  });

  it("Test 3: non-absolute path → 400 path_must_be_absolute", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({ hostname: "thenasty", absolutePath: "relative/path" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("path_must_be_absolute");
  });

  it("Test 4: path traversal → 400 path_traversal", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({ hostname: "thenasty", absolutePath: "/etc/../root/secret" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("path_traversal");
  });

  it("Test 5: forbidden path (/proc) → 400 path_forbidden BEFORE any SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({ hostname: "thenasty", absolutePath: "/proc/kmsg" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("path_forbidden");
    // Confirm NO SSH activity was fired for this rejection.
    expect(stubClient.sftp).not.toHaveBeenCalled();
  });

  it("Test 6: unknown host → 404 unknown_host (cross-user isolation)", async () => {
    (resolveHostByName as Mock).mockResolvedValue(null);
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "not-mine",
        absolutePath: "/etc/hostname",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("unknown_host");
  });

  it("Test 7: canAccessHost denies → 403 permission_denied", async () => {
    mockCanAccessHost = async () => ({ hasAccess: false });
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/etc/hostname",
      }),
    });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe("permission_denied");
  });

  it("Test 8: sftp.stat returns non-file → 400 not_a_file", async () => {
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 0, isFile: () => false }));
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/etc",
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("not_a_file");
  });

  it("Test 9: stat.size > MAX_BYTES (2 MB) → 413 too_large", async () => {
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() =>
          cb(null, { size: 3_000_000, isFile: () => true }),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/var/log/huge.log",
      }),
    });
    expect(res.status).toBe(413);
    expect((res.body as { error: string }).error).toBe("too_large");
    // readFile never called — the size check short-circuits BEFORE the read.
    expect(stubSftp.readFile).not.toHaveBeenCalled();
  });

  it("Test 10: success (extension hit) → 200 envelope with isTextByExt=true", async () => {
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() => cb(null, Buffer.from("# Hello", "utf8")));
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 7, isFile: () => true }));
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/home/ubuntu/note.md",
      }),
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      contentBase64: string;
      sizeBytes: number;
      contentType: string | null;
      extension: string | null;
      filename: string;
      isTextByExt: boolean;
      isTextByBytes?: boolean;
    };
    expect(Buffer.from(body.contentBase64, "base64").toString("utf8")).toBe(
      "# Hello",
    );
    expect(body.sizeBytes).toBe(7);
    expect(body.contentType).toBeNull();
    expect(body.extension).toBe("md");
    expect(body.filename).toBe("note.md");
    expect(body.isTextByExt).toBe(true);
    expect(body.isTextByBytes).toBeUndefined();
  });

  it("Test 11: success (extension miss, text bytes) → 200 with isTextByExt=false and isTextByBytes=true", async () => {
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() => cb(null, Buffer.from("plain ascii text", "utf8")));
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 16, isFile: () => true }));
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/home/ubuntu/mystery-file-no-ext-known",
      }),
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      isTextByExt: boolean;
      isTextByBytes?: boolean;
      extension: string | null;
    };
    expect(body.isTextByExt).toBe(false);
    expect(body.isTextByBytes).toBe(true);
  });

  it("Test 12: SFTP ENOENT → 404 not_found", async () => {
    stubSftp.stat.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(new Error("ENOENT: no such file or directory")));
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/nonexistent",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("not_found");
  });

  it("Test 13: SFTP Permission denied / EACCES → 403 permission_denied", async () => {
    stubSftp.stat.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() =>
          cb(new Error("EACCES: Permission denied /root/secret")),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/root/secret",
      }),
    });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe("permission_denied");
  });

  it("Test 15: unrelated SSH connect error → 502 host_unreachable", async () => {
    const { connectOneShot } = await import("../../ssh/ssh-one-shot.js");
    (connectOneShot as unknown as Mock).mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/etc/hostname",
      }),
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("host_unreachable");
  });

  it("Test 16 (T-40-05 info-leak): error responses NEVER contain err.message / absolutePath / filename", async () => {
    stubSftp.stat.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() =>
          cb(new Error("EACCES: Permission denied /root/very-secret.key")),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/root/very-secret.key",
      }),
    });
    expect(res.status).toBe(403);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("very-secret.key");
    expect(raw).not.toContain("/root/");
    expect(raw).not.toContain("EACCES");
  });

  it("Test 17 (W-2 symlink defense): sftp.realpath → /proc/kmsg → 400 path_forbidden; sftp.stat NEVER called", async () => {
    stubSftp.realpath.mockImplementation(
      (_p: string, cb: (err: Error | null, resolved: string) => void) => {
        queueMicrotask(() => cb(null, "/proc/kmsg"));
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/home/ubuntu/nasty-link",
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("path_forbidden");
    expect(stubSftp.realpath).toHaveBeenCalledTimes(1);
    // Fail-closed BEFORE any data access:
    expect(stubSftp.stat).not.toHaveBeenCalled();
    expect(stubSftp.readFile).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------------------------- */
/*  GET /file/:host/* tests (Tests 18-34)                                */
/* --------------------------------------------------------------------- */

describe("GET /file/:host/* — verbatim URL path", () => {
  it("Test 18: unauthenticated → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/etc/hostname",
    });
    expect(res.status).toBe(401);
  });

  it("Test 19: invalid hostname → 400 with text/plain body 'invalid_hostname'", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/bad%20name/etc/hostname",
    });
    expect(res.status).toBe(400);
    expect(res.rawBody).toContain("invalid_hostname");
    expect(String(res.headers["content-type"]).toLowerCase()).toBe(
      "text/plain; charset=utf-8",
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("Test 20: empty path after slash → 400 path_must_be_absolute", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/",
    });
    expect(res.status).toBe(400);
    expect(res.rawBody).toContain("path_must_be_absolute");
  });

  it("Test 21: traversal in wildcard → 400 path_traversal", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/foo/../etc/passwd",
    });
    expect(res.status).toBe(400);
    expect(res.rawBody).toContain("path_traversal");
  });

  it("Test 22: /proc path → 400 path_forbidden", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/proc/kmsg",
    });
    expect(res.status).toBe(400);
    expect(res.rawBody).toContain("path_forbidden");
  });

  it("Test 23: unknown host → 404 unknown_host (identical for missing vs. cross-user)", async () => {
    (resolveHostByName as Mock).mockResolvedValue(null);
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/mystery/etc/hostname",
    });
    expect(res.status).toBe(404);
    expect(res.rawBody).toContain("unknown_host");
  });

  it("Test 24: denied by permission → 403 permission_denied", async () => {
    mockCanAccessHost = async () => ({ hasAccess: false });
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/etc/hostname",
    });
    expect(res.status).toBe(403);
    expect(res.rawBody).toContain("permission_denied");
  });

  it("Test 25: 200 success on unknown-extension text file → sniff-fallback to text/plain inline", async () => {
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() => cb(null, Buffer.from("hello\n", "utf8")));
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 6, isFile: () => true }));
      },
    );
    // `hostname` has no extension → sniff-fallback fires. Bytes are printable
    // ASCII → sniffTextBytes returns true → dispatched as text/plain inline.
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/etc/hostname",
    });
    expect(res.status).toBe(200);
    expect(res.rawBody).toBe("hello\n");
    expect(String(res.headers["content-type"]).toLowerCase()).toBe(
      "text/plain; charset=utf-8",
    );
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["accept-ranges"]).toBe("bytes");
  });

  it("Test 25b: known extension .mp4 → video/mp4 inline (no disposition)", async () => {
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        // Fake MP4 magic bytes; content doesn't matter, the dispatch is by
        // extension so the sniff path never fires.
        queueMicrotask(() =>
          cb(null, Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])),
        );
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 8, isFile: () => true }));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/home/ubuntu/clip.mp4",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("Test 26 (XSS defense): .html file → attachment disposition, real content-type on the wire", async () => {
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() =>
          cb(null, Buffer.from("<script>alert(1)</script>", "utf8")),
        );
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 25, isFile: () => true }));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/home/ubuntu/evil.html",
    });
    expect(res.status).toBe(200);
    // Body bytes go through as-is — the defense is at the disposition
    // layer, not by rewriting bytes.
    expect(res.rawBody).toBe("<script>alert(1)</script>");
    expect(String(res.headers["content-type"]).toLowerCase()).toBe(
      "text/html; charset=utf-8",
    );
    // Attachment disposition — browser downloads rather than renders/executes.
    expect(String(res.headers["content-disposition"])).toContain("attachment");
    expect(String(res.headers["content-disposition"])).toContain(
      'filename="evil.html"',
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("Test 26b: .svg file → attachment disposition (executable-image guard)", async () => {
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() =>
          cb(null, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>", "utf8")),
        );
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 40, isFile: () => true }));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/home/ubuntu/icon.svg",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(String(res.headers["content-disposition"])).toContain("attachment");
  });

  it("Test 26c: unknown extension + binary content → octet-stream attachment", async () => {
    // ZIP magic bytes: 50 4B 03 04. Includes a null byte at offset 4+ to
    // trip the sniffer's hard-binary-marker rule.
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() =>
          cb(
            null,
            Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x01]),
          ),
        );
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 8, isFile: () => true }));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/home/ubuntu/mystery.dat",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(String(res.headers["content-disposition"])).toContain("attachment");
    expect(String(res.headers["content-disposition"])).toContain(
      'filename="mystery.dat"',
    );
  });

  it("Test 26d (Range request): mp4 with Range: bytes=2-5 → 206 Partial Content", async () => {
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() =>
          cb(null, Buffer.from([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7])),
        );
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 8, isFile: () => true }));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/home/ubuntu/clip.mp4",
      headers: { Range: "bytes=2-5" },
    });
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 2-5/8");
    expect(res.headers["content-length"]).toBe("4");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-type"]).toBe("video/mp4");
    // Body should be 4 bytes: 0xa2, 0xa3, 0xa4, 0xa5.
    expect(Buffer.from(res.rawBody, "binary")).toHaveLength(4);
  });

  it("Test 26e (Range request unsatisfiable): start beyond size → 416", async () => {
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 8, isFile: () => true }));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/home/ubuntu/clip.mp4",
      headers: { Range: "bytes=100-200" },
    });
    expect(res.status).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */8");
  });

  it("Test 27: SFTP EACCES → 403 permission_denied", async () => {
    stubSftp.stat.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(new Error("EACCES: Permission denied")));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/root/secret",
    });
    expect(res.status).toBe(403);
    expect(res.rawBody).toContain("permission_denied");
  });

  it("Test 28: SFTP ENOENT → 404 not_found", async () => {
    stubSftp.stat.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(new Error("ENOENT: no such file")));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/nonexistent",
    });
    expect(res.status).toBe(404);
    expect(res.rawBody).toContain("not_found");
  });

  it("Test 29: oversized file (> 10 GiB cap) → 413 too_large", async () => {
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        // 11 GiB — comfortably above MAX_BYTES_GET (10 GiB).
        queueMicrotask(() =>
          cb(null, { size: 11 * 1024 ** 3, isFile: () => true }),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/var/log/huge.log",
    });
    expect(res.status).toBe(413);
    expect(res.rawBody).toContain("too_large");
  });

  it("Test 29b: 3 MB file (well within 10 GiB cap) → 200 success", async () => {
    // A file that would have hit the OLD 2 MB cap; verify the raised
    // ceiling by asserting a successful stream on a "big" file.
    const bigBuf = Buffer.alloc(3_000_000, 0x41); // 3 MB of 'A'
    stubSftp.readFile.mockImplementation(
      (_p: string, cb: (err: Error | null, data: Buffer) => void) => {
        queueMicrotask(() => cb(null, bigBuf));
      },
    );
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() =>
          cb(null, { size: bigBuf.length, isFile: () => true }),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/var/log/big.log",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-length"]).toBe(String(bigBuf.length));
    expect(res.rawBody.length).toBe(bigBuf.length);
  });

  it("Test 30: not-a-file (directory) → 400 not_a_file", async () => {
    stubSftp.stat.mockImplementation(
      (
        _p: string,
        cb: (
          err: Error | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => cb(null, { size: 4096, isFile: () => false }));
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/etc",
    });
    expect(res.status).toBe(400);
    expect(res.rawBody).toContain("not_a_file");
  });

  it("Test 32: unrelated SSH connect error → 502 host_unreachable", async () => {
    const { connectOneShot } = await import("../../ssh/ssh-one-shot.js");
    (connectOneShot as unknown as Mock).mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/etc/hostname",
    });
    expect(res.status).toBe(502);
    expect(res.rawBody).toContain("host_unreachable");
  });

  it("Test 33 (T-40-05 GET info-leak): error body NEVER leaks err.message / absolute path / filename beyond user input", async () => {
    stubSftp.stat.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() =>
          cb(
            new Error(
              "EACCES: internal-server-path-should-not-leak /var/lib/foo/x",
            ),
          ),
        );
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/root/secret",
    });
    expect(res.status).toBe(403);
    expect(res.rawBody).not.toContain(
      "internal-server-path-should-not-leak",
    );
    expect(res.rawBody).not.toContain("/var/lib/foo/x");
    expect(res.rawBody).not.toContain("EACCES");
  });

  it("Test 34 (XSS-defense headers on ALL responses): 200 + error paths BOTH set the three headers", async () => {
    // Assert 200 headers already checked in Test 25; here also assert on an
    // error path: use an unknown-host to trigger 404 and verify headers.
    (resolveHostByName as Mock).mockResolvedValue(null);
    const res = await httpRequest(server, {
      method: "GET",
      path: "/file/mystery/etc/hostname",
    });
    expect(res.status).toBe(404);
    expect(String(res.headers["content-type"]).toLowerCase()).toBe(
      "text/plain; charset=utf-8",
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("Test 31 (SSH timeout): SFTP hangs → 504 ssh_timeout via AbortController", async () => {
    // Simulate a hung SFTP stat that never invokes its callback within
    // SFTP_READ_TIMEOUT_MS (8s). We shrink the wait by having the mock
    // resolve after a small delay AND have the handler abort earlier via
    // the internal AbortController — but to keep the test fast we
    // intercept realpath to hang and rely on the handler's timeout logic
    // to trigger. The test uses vi.useFakeTimers to keep it deterministic.
    vi.useFakeTimers();
    stubSftp.realpath.mockImplementation(
      (_p: string, _cb: (err: Error | null, resolved: string) => void) => {
        // Never invokes cb — simulates a hung SFTP call
      },
    );
    const resPromise = httpRequest(server, {
      method: "GET",
      path: "/file/thenasty/etc/hostname",
    });
    // Advance past the 8s timeout
    await vi.advanceTimersByTimeAsync(9_000);
    vi.useRealTimers();
    const res = await resPromise;
    expect(res.status).toBe(504);
    expect(res.rawBody).toContain("ssh_timeout");
  }, 20_000);
});

/* --------------------------------------------------------------------- */
/*  Ghost-alias absence (W-3) — wire-level assertion                     */
/* --------------------------------------------------------------------- */

describe("Split-router ghost-alias absence (W-3)", () => {
  it("POST /fetch-host-file at root → 404 (POST-only router mounted at /pretty-view; root mount is GET-only)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/fetch-host-file",
      body: JSON.stringify({
        hostname: "thenasty",
        absolutePath: "/etc/hostname",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /pretty-view/file/:host/* → 404 (GET-only router mounted at /; /pretty-view mount is POST-only)", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/pretty-view/file/thenasty/etc/hostname",
    });
    expect(res.status).toBe(404);
  });
});
