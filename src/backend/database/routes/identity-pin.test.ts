// Tests for PUT /identities/:key/pinned (single-identity pin toggle).
// Harness copied from identity-archive.test.ts.
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
// Auth manager mock — matches identity-no-dormancy.test.ts pattern
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

// Mute logger during tests (avoid noisy stderr on the T-115-03-03 500 path).
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock SSH primitives + writeIdentityFile BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  stringifyColorHueForYaml: (obj: Record<string, unknown>) => (typeof obj.colorHue === "number" ? { ...obj, colorHue: String(obj.colorHue) } : obj),
  isLocalHostId: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
}));

vi.mock("../../claude-session/per-identity-file.js", () => ({
  writeIdentityFile: vi.fn(),
  removeIdentityFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityFile, removeIdentityFile } from "../../claude-session/per-identity-file.js";

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

import router from "./identity-pin.js";

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

  // Default: writeIdentityFile succeeds
  (writeIdentityFile as Mock).mockResolvedValue(undefined);
  (removeIdentityFile as Mock).mockResolvedValue(undefined);

  // Rebuild app per test
  const app = express();
  app.use(express.json());
  app.use("/identities", router);

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

describe("PUT /identities/:key/pinned", () => {
  it("pinned:true on LOCAL host writes .pinned with conn=null, no SSH", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/wren/pinned",
      body: { hostId: 5, pinned: true },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pinned: true });
    expect(writeIdentityFile).toHaveBeenCalledWith("wren", ".pinned", "", { hostId: 5, conn: null });
    expect(removeIdentityFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("pinned:false on REMOTE host removes .pinned over SSH and closes the conn", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/wren/pinned",
      body: { hostId: 7, pinned: false },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pinned: false });
    expect(removeIdentityFile).toHaveBeenCalledWith("wren", ".pinned", { hostId: 7, conn: stubConn });
    expect(writeIdentityFile).not.toHaveBeenCalled();
    expect(stubConn.end).toHaveBeenCalled();
  });

  it("rejects bad key / missing hostId / non-boolean pinned with 400", async () => {
    for (const [path, body] of [
      ["/identities/Bad%20Key/pinned", { hostId: 5, pinned: true }],
      ["/identities/wren/pinned", { pinned: true }],
      ["/identities/wren/pinned", { hostId: 5, pinned: "yes" }],
    ] as const) {
      const res = await httpRequest(server, { method: "PUT", path, body });
      expect(res.status).toBe(400);
    }
    expect(writeIdentityFile).not.toHaveBeenCalled();
  });

  it("unowned host → 404, no write", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/wren/pinned",
      body: { hostId: 99, pinned: true },
    });
    expect(res.status).toBe(404);
    expect(writeIdentityFile).not.toHaveBeenCalled();
  });

  it("SSH connect failure → 504", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("timeout"));
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/wren/pinned",
      body: { hostId: 7, pinned: true },
    });
    expect(res.status).toBe(504);
  });

  it("write failure → 500 and conn still closed", async () => {
    (writeIdentityFile as Mock).mockRejectedValueOnce(new Error("disk full"));
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/wren/pinned",
      body: { hostId: 7, pinned: true },
    });
    expect(res.status).toBe(500);
    expect(stubConn.end).toHaveBeenCalled();
  });

  it("401 without auth", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/wren/pinned",
      body: { hostId: 5, pinned: true },
    });
    expect(res.status).toBe(401);
  });
});
