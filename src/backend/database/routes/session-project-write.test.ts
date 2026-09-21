/**
 * Phase 117 Plan 117-05 Task 1: Tests for the session-project-write route.
 *
 * Tests exercise POST /identities/:key/project — the identity-file
 * frontmatter write path for identity-associated conversations.
 *
 * Test file shape mirrors identity-archive.test.ts (Phase 115 Plan 115-03).
 * Auth middleware is mocked. writeSessionProjectField, resolveHostById,
 * connectOneShot, isLocalHostId, and listProjects are mocked so tests
 * exercise every branch without touching real disk or SSH.
 *
 * Test coverage (11 tests per plan behavior block):
 *   1: Happy assign LOCAL — writeSessionProjectField called with (null, "wren",
 *      "alpha"); 200 { ok: true }; publishProjectListChanged fires once.
 *   2: Happy assign REMOTE — connectOneShot called + writeSessionProjectField
 *      called with (mockConn, "wren", "alpha"); conn.end() called in finally.
 *   3: Happy clear — body { hostId, project: null }; writeSessionProjectField
 *      called with (null, "wren", null).
 *   4: Bad hostId → 400 { error: "hostId is required" }.
 *   5: Bad identity key → 400.
 *   6: Bad slug value (uppercase) → 400 with error mentioning slug.
 *   7: Body variants — missing project (400) / empty string (400) / number (400)
 *      / null (200 clear) / valid slug (200 set).
 *   8: Unknown host → 404.
 *   9: SSH unreachable → 504 { error: "Host unreachable" }.
 *   10: writeSessionProjectField throws → 500 generic (no leak);
 *       publishProjectListChanged NOT called.
 *   11: Unauth → 401.
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
// Auth manager mock — matches identity-archive.test.ts pattern
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
// Mock SSH primitives + writeSessionProjectField BEFORE importing the module
// under test.
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  PROJECT_SLUG_RE: /^[a-z0-9-]{1,64}$/,
  writeSessionProjectField: vi.fn(),
  listProjects: vi.fn(),
}));

// subscription-registry singleton accessor — Wave 2 route relies on this
// to reach the WS registry that starter.ts creates.
const mockPublishProjectListChanged = vi.fn();
const mockPublishSessionProjectChanged = vi.fn();
vi.mock("../../fleet-status/subscription-registry.js", () => ({
  getSubscriptionRegistry: () => ({
    publishProjectListChanged: mockPublishProjectListChanged,
    publishSessionProjectChanged: mockPublishSessionProjectChanged,
  }),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  isLocalHostId,
  writeSessionProjectField,
  listProjects,
} from "../../claude-session/identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// HTTP request helper — mirrors identity-archive.test.ts
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
  name: "myhost",
  ip: "10.0.0.5",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import the router under test — AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router from "./session-project-write.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Default: user owns host 5 (local) and host 7 (remote); host 99 not owned.
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 5 || hostId === 7)
      return Promise.resolve({ ...stubHost, id: hostId });
    return Promise.resolve(null);
  });

  // Default: hostId 5 is local, hostId 7 is remote.
  (isLocalHostId as Mock).mockImplementation((hostId: number) => hostId === 5);

  // Default: SSH connect resolves to stubConn.
  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default: writeSessionProjectField succeeds.
  (writeSessionProjectField as Mock).mockResolvedValue(undefined);

  // Default: listProjects resolves to [] (empty list post-write is fine).
  (listProjects as Mock).mockResolvedValue([]);

  // Rebuild app per test.
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

// ===========================================================================
// Tests
// ===========================================================================

describe("POST /identities/:key/project", () => {
  // -------------------------------------------------------------------------
  // Test 1: happy assign LOCAL
  // -------------------------------------------------------------------------

  it("Test 1: happy LOCAL → 200; writeSessionProjectField(null, key, slug); publish once", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: "alpha" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeSessionProjectField).toHaveBeenCalledTimes(1);
    expect(writeSessionProjectField).toHaveBeenCalledWith(null, "wren", "alpha");
    // LOCAL branch must not open an SSH connection.
    expect(connectOneShot).not.toHaveBeenCalled();
    // Phase 117 M5 fix (2026-09-18): session-field writes do NOT change
    // the projects[] list, so this route no longer publishes anything on
    // that channel — and no longer re-enumerates via listProjects.
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
    // The session-project-changed per-identity delta DOES fire — this is
    // what the sidebar subscribes to for live row updates.
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledTimes(1);
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledWith(
      "wren",
      5,
      "alpha",
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: happy assign REMOTE
  // -------------------------------------------------------------------------

  it("Test 2: happy REMOTE → 200; conn passed to writer; conn.end() in finally", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 7, project: "alpha" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(writeSessionProjectField).toHaveBeenCalledTimes(1);
    expect(writeSessionProjectField).toHaveBeenCalledWith(
      stubConn,
      "wren",
      "alpha",
    );
    // Finally block must close the SSH connection.
    expect(stubConn.end).toHaveBeenCalledTimes(1);
    // Phase 117 M5 fix (2026-09-18): no project-list publish, no extra
    // listProjects round-trip on a session-field write.
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
    // session-project-changed per-identity delta fires on REMOTE too.
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledTimes(1);
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledWith(
      "wren",
      7,
      "alpha",
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: happy clear (project: null)
  // -------------------------------------------------------------------------

  it("Test 3: happy CLEAR → 200; writeSessionProjectField(null, key, null)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: null },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeSessionProjectField).toHaveBeenCalledTimes(1);
    expect(writeSessionProjectField).toHaveBeenCalledWith(null, "wren", null);
    // Clear gesture fires the delta with project=null.
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledTimes(1);
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledWith(
      "wren",
      5,
      null,
    );
  });

  // -------------------------------------------------------------------------
  // Test 4: missing hostId → 400
  // -------------------------------------------------------------------------

  it("Test 4: missing hostId → 400 { error: 'hostId is required' }", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { project: "alpha" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId is required/);
    expect(writeSessionProjectField).not.toHaveBeenCalled();
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
    expect(mockPublishSessionProjectChanged).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: bad identity key path segment → 400
  // -------------------------------------------------------------------------

  it("Test 5: bad identity key path segment → 400; writer NOT called", async () => {
    // "BAD!" fails IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/ (uppercase + !).
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/BAD!/project",
      body: { hostId: 5, project: "alpha" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/identity key/);
    expect(writeSessionProjectField).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: bad slug value (uppercase) → 400
  // -------------------------------------------------------------------------

  it("Test 6: bad slug value (uppercase) → 400 mentioning slug", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: "Alpha" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/slug/i);
    expect(writeSessionProjectField).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: project must be string or null (strict typing)
  // -------------------------------------------------------------------------

  it("Test 7: project must be string or null (missing → 400)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/project/i);
    expect(writeSessionProjectField).not.toHaveBeenCalled();
  });

  it("Test 7b: project must be string or null (empty string → 400)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: "" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/project/i);
    expect(writeSessionProjectField).not.toHaveBeenCalled();
  });

  it("Test 7c: project must be string or null (number → 400)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: 123 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/project/i);
    expect(writeSessionProjectField).not.toHaveBeenCalled();
  });

  it("Test 7d: project=null → 200 (clear)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: null },
    });
    expect(res.status).toBe(200);
    expect(writeSessionProjectField).toHaveBeenCalledWith(null, "wren", null);
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledWith(
      "wren",
      5,
      null,
    );
  });

  it("Test 7e: project='abc' → 200 (set)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: "abc" },
    });
    expect(res.status).toBe(200);
    expect(writeSessionProjectField).toHaveBeenCalledWith(null, "wren", "abc");
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledWith(
      "wren",
      5,
      "abc",
    );
  });

  // -------------------------------------------------------------------------
  // Test 7f: publisher throws → write still succeeds → 200
  // -------------------------------------------------------------------------

  it("Test 7f: publisher throws → 200 { ok: true } (write not turned into 500)", async () => {
    mockPublishSessionProjectChanged.mockImplementationOnce(() => {
      throw new Error("fanout registry blew up");
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: "alpha" },
    });

    // Write succeeded on disk; the fanout is best-effort and MUST NOT
    // convert a successful mutation into a client-facing 500.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeSessionProjectField).toHaveBeenCalledTimes(1);
    // Publisher was invoked (and threw); the on-error handler swallowed it.
    expect(mockPublishSessionProjectChanged).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 8: unknown host → 404 (probe defense)
  // -------------------------------------------------------------------------

  it("Test 8: unknown / cross-user hostId → 404; writer NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 99, project: "alpha" },
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    expect(writeSessionProjectField).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 9: SSH unreachable → 504
  // -------------------------------------------------------------------------

  it("Test 9: REMOTE connectOneShot throws → 504 { error: 'Host unreachable' }", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 7, project: "alpha" },
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(writeSessionProjectField).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 10: writeSessionProjectField throws → 500 (no leak); NO publish
  // -------------------------------------------------------------------------

  it("Test 10: writer throws → 500 generic; publish NOT called; conn.end() still called (REMOTE)", async () => {
    (writeSessionProjectField as Mock).mockRejectedValue(
      new Error("ENOSPC: sensitive fs path leak"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 7, project: "alpha" },
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to write session project" });
    // No error leak.
    expect(JSON.stringify(res.body)).not.toContain("ENOSPC");
    expect(JSON.stringify(res.body)).not.toContain("sensitive");
    // Publishers only fire on write success — write threw before we hit
    // the publish site.
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
    expect(mockPublishSessionProjectChanged).not.toHaveBeenCalled();
    // finally { conn.end() } fires even on write throw.
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 11: unauth → 401
  // -------------------------------------------------------------------------

  it("Test 11: unauthenticated (no JWT) → 401; no downstream calls", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/project",
      body: { hostId: 5, project: "alpha" },
    });

    expect(res.status).toBe(401);
    expect(writeSessionProjectField).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});
