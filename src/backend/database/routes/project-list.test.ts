/**
 * Phase 117 Plan 117-04: Tests for the /projects route.
 *
 * Tests exercise:
 *   GET  /projects?hostId=<n>
 *   POST /projects
 *   POST /projects/:slug/archive
 *
 * All routes gate on authenticateJWT + resolveHostById(hostId, userId) with
 * 404-on-cross-user (probe-distinguisher defense). Every route uses a JSON
 * body per D-36a. Every successful write path calls
 * subscriptionRegistry.publishProjectListChanged(<currentProjectsArray>).
 *
 * Auth middleware is mocked. resolveHostById, connectOneShot, isLocalHostId,
 * listProjects, createProject, archiveProject are mocked so tests exercise
 * every branch without touching real disk or SSH.
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

// Mute logger during tests.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// SSH + artifact-reader mocks
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  PROJECT_SLUG_RE: /^[a-z0-9-]{1,64}$/,
  listProjects: vi.fn(),
  createProject: vi.fn(),
  archiveProject: vi.fn(),
}));

// subscription-registry singleton accessor — Wave 2 route relies on this
// to reach the WS registry that starter.ts creates. See getSubscriptionRegistry
// export added in Phase 117 Plan 04.
const mockPublishProjectListChanged = vi.fn();
vi.mock("../../fleet-status/subscription-registry.js", () => ({
  getSubscriptionRegistry: () => ({
    publishProjectListChanged: mockPublishProjectListChanged,
  }),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  isLocalHostId,
  listProjects,
  createProject,
  archiveProject,
} from "../../claude-session/identity-artifact-reader.js";

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
    sendAuthHeader?: boolean;
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
// Stubs
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
// Import the router under test AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router, { normalizeToSlug } from "./project-list.js";

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

  // Default: primitives resolve to sensible defaults; per-test overrides.
  (listProjects as Mock).mockResolvedValue([]);
  (createProject as Mock).mockResolvedValue(undefined);
  (archiveProject as Mock).mockResolvedValue(undefined);

  // Rebuild app per test.
  const app = express();
  app.use(express.json());
  app.use("/projects", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  mockUserId = "1";
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
// GET /projects
// ===========================================================================

describe("GET /projects", () => {
  it("Test 1: happy LOCAL → 200 with archived:false enriched projects; no SSH", async () => {
    (listProjects as Mock).mockResolvedValue([
      { slug: "a", displayName: "Alpha" },
    ]);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=5",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projects: [{ slug: "a", displayName: "Alpha", archived: false }],
    });
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(listProjects).toHaveBeenCalledWith(null);
  });

  it("Test 2: happy REMOTE → 200 with SSH conn passed; conn.end() in finally", async () => {
    (listProjects as Mock).mockResolvedValue([
      { slug: "a", displayName: "Alpha" },
      { slug: "b", displayName: "Beta" },
    ]);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=7",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projects: [
        { slug: "a", displayName: "Alpha", archived: false },
        { slug: "b", displayName: "Beta", archived: false },
      ],
    });
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(listProjects).toHaveBeenCalledWith(stubConn);
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test 3: missing hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId is required/);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("Test 4: bad hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=abc",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("Test 5: unknown/cross-user hostId → 404 (NOT 403 — probe defense)", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=99",
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("Test 6: REMOTE unreachable (connectOneShot throws) → 504", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=7",
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("Test 7: unauth (no JWT) → 401; listProjects not called", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=5",
    });

    expect(res.status).toBe(401);
    expect(listProjects).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// POST /projects
// ===========================================================================

describe("POST /projects", () => {
  it("Test 8: happy → 200 { ok:true, slug:<derived> }; publishProjectListChanged called once", async () => {
    (listProjects as Mock).mockResolvedValue([
      { slug: "my-project", displayName: "My Project" },
    ]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "My Project" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, slug: "my-project" });
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(null, "my-project", "My Project");
    // publishProjectListChanged should fire exactly once after successful write.
    expect(mockPublishProjectListChanged).toHaveBeenCalledTimes(1);
    // The published array reflects the just-created projects with wire-event
    // enrichment (hostId as string + hostname from resolveHostById + archived).
    const callArg = mockPublishProjectListChanged.mock.calls[0][0];
    expect(Array.isArray(callArg)).toBe(true);
    expect(callArg).toEqual([
      {
        slug: "my-project",
        displayName: "My Project",
        hostId: "5",
        hostname: "myhost",
        archived: false,
      },
    ]);
  });

  it("Test 9: auto-slugify variants — normalizeToSlug is authoritative", async () => {
    // Whitespace + punctuation → single dashes, trimmed, lowercased.
    expect(normalizeToSlug("  Foo  Bar!! ")).toBe("foo-bar");
    expect(normalizeToSlug("Alpha 123")).toBe("alpha-123");
    expect(normalizeToSlug("already-dashed")).toBe("already-dashed");
    // Pure separators → empty slug → 400.
    expect(normalizeToSlug("___")).toBe("");

    // Empty-slug path returns 400 at the route.
    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "___" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/alphanumeric/);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("Test 10: rejects displayName (missing / empty / oversize)", async () => {
    // Missing
    let res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/displayName/);

    // Empty string
    res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/displayName/);

    // > 80 chars
    res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "a".repeat(81) },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/displayName/);

    expect(createProject).not.toHaveBeenCalled();
  });

  it("Test 11: duplicate slug (EEXIST from createProject) → 409 { error:'slug exists', slug }", async () => {
    const err = new Error("project slug already exists: my-project");
    (err as NodeJS.ErrnoException).code = "EEXIST";
    (createProject as Mock).mockRejectedValue(err);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "My Project" },
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "slug exists", slug: "my-project" });
    // No wire event on failure.
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
  });

  it("Test 12: unknown / cross-user host → 404 (probe defense)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 99, displayName: "My Project" },
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    expect(createProject).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// POST /projects/:slug/archive
// ===========================================================================

describe("POST /projects/:slug/archive", () => {
  it("Test 13: happy → 200 { ok:true }; archiveProject called; publishProjectListChanged called", async () => {
    (listProjects as Mock).mockResolvedValue([]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects/my-project/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(archiveProject).toHaveBeenCalledTimes(1);
    expect(archiveProject).toHaveBeenCalledWith(null, "my-project");
    expect(mockPublishProjectListChanged).toHaveBeenCalledTimes(1);
    // Post-archive, the enriched wire event carries the current (post-archive)
    // list — in this test the list is empty (project just archived).
    expect(mockPublishProjectListChanged.mock.calls[0][0]).toEqual([]);
  });

  it("Test 14: bad slug (uppercase / metacharacters) → 400 (PROJECT_SLUG_RE gate)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects/BAD!/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/slug/);
    expect(archiveProject).not.toHaveBeenCalled();
  });

  it("Test 15: unknown host → 404", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects/my-project/archive",
      body: { hostId: 99 },
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    expect(archiveProject).not.toHaveBeenCalled();
  });

  it("Test 16: archiveProject throws → 500 generic (no err.message leak)", async () => {
    (archiveProject as Mock).mockRejectedValue(
      new Error(
        "EACCES: /private/fs/path leaked — sensitive info to caller",
      ),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects/my-project/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to archive project" });
    // T-117-04-05 — underlying err.message must NOT reach the client.
    expect(JSON.stringify(res.body)).not.toContain("EACCES");
    expect(JSON.stringify(res.body)).not.toContain("sensitive info");
    // Failure → no wire event.
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Cross-cutting
// ===========================================================================

describe("cross-cutting", () => {
  it("Test 17: all 3 endpoints under authenticateJWT (401 without header)", async () => {
    mockUserId = null;

    const getRes = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=5",
    });
    expect(getRes.status).toBe(401);

    const postRes = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "X" },
    });
    expect(postRes.status).toBe(401);

    const archiveRes = await httpRequest(server, {
      method: "POST",
      path: "/projects/my-project/archive",
      body: { hostId: 5 },
    });
    expect(archiveRes.status).toBe(401);

    // Absolutely no downstream calls happened.
    expect(listProjects).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
    expect(archiveProject).not.toHaveBeenCalled();
  });

  it("Test 18: normalizeToSlug is the SHARED contract (5 samples)", async () => {
    // Backend is authoritative for slugify per Pitfall 1. The frontend modal
    // (117-09) submits the raw displayName and echoes the slug back; this test
    // pins the exact algorithm output on 5 sample inputs so any drift is caught.
    expect(normalizeToSlug("Foo Bar")).toBe("foo-bar");
    expect(normalizeToSlug("HELLO_WORLD")).toBe("hello-world");
    expect(normalizeToSlug("--trim--dashes--")).toBe("trim-dashes");
    expect(normalizeToSlug("naïve")).toBe("na-ve"); // non-ASCII → dash
    expect(normalizeToSlug("v2.0.1")).toBe("v2-0-1");
  });
});
