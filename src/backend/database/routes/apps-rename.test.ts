/**
 * Tests for the app-rename route (PATCH /apps/:hostId/:slug).
 *
 * Harness mirrors apps-archive.test.ts: bare Express app + node:http,
 * auth / SSH / host-resolver mocked, updateAppTitle stubbed while the real
 * validateAppTitle + AppManifestError flow through.
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
// Auth manager mock
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

// Mute logger during tests (avoid noisy stderr on the 500 path).
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock SSH primitives + identity-artifact-reader + updateAppTitle
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// APP_SLUG_RE is a real constant (not a stubbable function). Pass it through
// verbatim so the route's slug gate uses the real regex; isLocalHostId is a
// function we want to control per test.
vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  APP_SLUG_RE: /^[a-z0-9-]{1,64}$/,
}));

// Route maps AppManifestError by instanceof, so keep the real class + the
// real title validator; only the I/O function is stubbed.
vi.mock("../../claude-session/per-app-file.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../claude-session/per-app-file.js")>();
  return {
    AppManifestError: actual.AppManifestError,
    validateAppTitle: actual.validateAppTitle,
    updateAppTitle: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import {
  updateAppTitle,
  AppManifestError,
} from "../../claude-session/per-app-file.js";
import { databaseLogger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
    };
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
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
    if (bodyStr !== undefined) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stubs — SSH connection object + host record
// ---------------------------------------------------------------------------

const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

const stubHost = {
  id: 5,
  ip: "10.0.0.5",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import the router under test — AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router from "./apps-rename.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Default: user owns host 5 (local) and host 7 (remote); host 99 not owned
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 5 || hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  // Default: hostId 5 is local, hostId 7 is remote
  (isLocalHostId as Mock).mockImplementation((hostId: number) => hostId === 5);

  // Default: SSH connect resolves to stubConn
  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default: updateAppTitle echoes the (already-trimmed) title
  (updateAppTitle as Mock).mockImplementation((_slug: string, title: string) =>
    Promise.resolve({ title }),
  );

  const app = express();
  app.use(express.json());
  app.use("/apps", router);

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

function patch(path: string, body?: unknown) {
  return httpRequest(server, { method: "PATCH", path, body });
}

describe("PATCH /apps/:hostId/:slug", () => {
  it("happy LOCAL → 200 with trimmed title; no SSH; audit log", async () => {
    const res = await patch("/apps/5/my-app", { title: "  New Name  " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, title: "New Name" });
    expect(updateAppTitle).toHaveBeenCalledWith("my-app", "New Name", {
      hostId: 5,
      conn: null,
    });
    expect(connectOneShot).not.toHaveBeenCalled();
    const infoMsg = (databaseLogger.info as unknown as Mock).mock.calls[0][0] as string;
    expect(infoMsg).toMatch(/app renamed: userId=1, hostId=5, slug=my-app/);
  });

  it("happy REMOTE → opens SSH, passes conn, closes it", async () => {
    const res = await patch("/apps/7/my-app", { title: "New" });
    expect(res.status).toBe(200);
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(updateAppTitle).toHaveBeenCalledWith("my-app", "New", {
      hostId: 7,
      conn: stubConn,
    });
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing body", undefined],
    ["missing title", {}],
    ["non-string title", { title: 5 }],
    ["blank title", { title: "   " }],
    ["over-long title", { title: "x".repeat(81) }],
    ["control chars", { title: "a\nb" }],
  ])("400 on %s; no host lookup or write", async (_l, body) => {
    const res = await patch("/apps/5/my-app", body);
    expect(res.status).toBe(400);
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(updateAppTitle).not.toHaveBeenCalled();
  });

  it.each(["My-App", "my_app", "..%2Fetc"])("400 on bad slug %s", async (slug) => {
    const res = await patch(`/apps/5/${slug}`, { title: "New" });
    expect(res.status).toBe(400);
    expect(updateAppTitle).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "abc", "1.5"])("400 on bad hostId %s", async (hostId) => {
    const res = await patch(`/apps/${hostId}/my-app`, { title: "New" });
    expect(res.status).toBe(400);
    expect(updateAppTitle).not.toHaveBeenCalled();
  });

  it("404 when host isn't owned", async () => {
    const res = await patch("/apps/99/my-app", { title: "New" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Host not found" });
    expect(updateAppTitle).not.toHaveBeenCalled();
  });

  it("504 when REMOTE SSH connect fails", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("timeout"));
    const res = await patch("/apps/7/my-app", { title: "New" });
    expect(res.status).toBe(504);
    expect(updateAppTitle).not.toHaveBeenCalled();
  });

  it("404 'app not found' when app.json is missing", async () => {
    (updateAppTitle as Mock).mockRejectedValueOnce(
      new AppManifestError("not_found", "app.json not found"),
    );
    const res = await patch("/apps/7/my-app", { title: "New" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "app not found" });
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("409 when app.json is malformed", async () => {
    (updateAppTitle as Mock).mockRejectedValueOnce(
      new AppManifestError("malformed", "app.json is not valid JSON"),
    );
    const res = await patch("/apps/5/my-app", { title: "New" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "app.json is malformed" });
  });

  it("500 generic body on unexpected error; detail not leaked; conn closed", async () => {
    (updateAppTitle as Mock).mockRejectedValueOnce(new Error("sftp: secret detail"));
    const res = await patch("/apps/7/my-app", { title: "New" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to rename app" });
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await patch("/apps/5/my-app", { title: "New" });
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(updateAppTitle).not.toHaveBeenCalled();
  });
});
