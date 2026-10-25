/**
 * Tests for POST /identities/:key/condense — the Condense conversation button's
 * request. Same harness as identity-archive.test.ts: bare Express app, mocked
 * auth, SSH primitives and writeIdentityFile.
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
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityFile } from "../../claude-session/per-identity-file.js";

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

import router, { GUIDANCE_MAX_CHARS, normalizeGuidance } from "./identity-condense.js";

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

describe("POST /identities/:key/condense", () => {
  it("LOCAL: drops .compact-requested with no guidance → 200, no SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/condense",
      body: { hostId: 5 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeIdentityFile).toHaveBeenCalledWith("wren", ".compact-requested", "", {
      hostId: 5,
      conn: null,
    });
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("REMOTE: guidance is flattened to one line and written; conn closed", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/condense",
      body: { hostId: 7, guidance: "  keep the\nfailing   test details \n" },
    });
    expect(res.status).toBe(200);
    expect(writeIdentityFile).toHaveBeenCalledWith(
      "wren",
      ".compact-requested",
      "keep the failing test details",
      { hostId: 7, conn: stubConn },
    );
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("non-string guidance is ignored", async () => {
    await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/condense",
      body: { hostId: 5, guidance: { evil: true } },
    });
    expect(writeIdentityFile).toHaveBeenCalledWith("wren", ".compact-requested", "", {
      hostId: 5,
      conn: null,
    });
  });

  it("invalid key → 400, nothing written", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/bad.key/condense",
      body: { hostId: 5 },
    });
    expect(res.status).toBe(400);
    expect(writeIdentityFile).not.toHaveBeenCalled();
  });

  it("missing hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/condense",
      body: {},
    });
    expect(res.status).toBe(400);
    expect(writeIdentityFile).not.toHaveBeenCalled();
  });

  it("host not owned → 404", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/condense",
      body: { hostId: 99 },
    });
    expect(res.status).toBe(404);
    expect(writeIdentityFile).not.toHaveBeenCalled();
  });

  it("REMOTE unreachable → 504", async () => {
    (connectOneShot as Mock).mockRejectedValue(new Error("timeout"));
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/condense",
      body: { hostId: 7 },
    });
    expect(res.status).toBe(504);
    expect(writeIdentityFile).not.toHaveBeenCalled();
  });

  it("write fails → 500 generic, conn still closed", async () => {
    (writeIdentityFile as Mock).mockRejectedValue(new Error("ENOSPC secret path"));
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/condense",
      body: { hostId: 7 },
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to request condense" });
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("unauthenticated → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/condense",
      body: { hostId: 5 },
    });
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
  });
});

describe("normalizeGuidance", () => {
  it("caps by characters, not bytes", () => {
    const long = "é".repeat(GUIDANCE_MAX_CHARS + 50);
    expect(Array.from(normalizeGuidance(long))).toHaveLength(GUIDANCE_MAX_CHARS);
  });
  it("empty / whitespace / non-string → empty", () => {
    expect(normalizeGuidance("  \n ")).toBe("");
    expect(normalizeGuidance(undefined)).toBe("");
    expect(normalizeGuidance(42)).toBe("");
  });
});
