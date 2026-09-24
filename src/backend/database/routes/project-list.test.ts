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
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn(),
}));

// Phase 130: host-user-counter mock — auto-tag path in POST /projects consults
// isHostMultiUser + getUsernameForUserId. Default is single-user + no
// username, so auto-tag stays quiet across every pre-130 test unless a
// specific test overrides.
vi.mock("../../utils/host-user-counter.js", () => ({
  isHostMultiUser: vi.fn().mockResolvedValue(false),
  getUsernameForUserId: vi.fn().mockResolvedValue(null),
}));

// subscription-registry singleton accessor — Wave 2 route relies on this
// to reach the WS registry that starter.ts creates. See getSubscriptionRegistry
// export added in Phase 117 Plan 04.
//
// Phase 117 M8 fix (2026-09-18): the mock now consults a mutable flag so
// specific tests can simulate the null-registry path (a startup-timing
// bug in production; a common state during initial test setup).
const mockPublishProjectListChanged = vi.fn();
let mockRegistryIsNull = false;
vi.mock("../../fleet-status/subscription-registry.js", () => ({
  getSubscriptionRegistry: () =>
    mockRegistryIsNull
      ? null
      : {
          publishProjectListChanged: mockPublishProjectListChanged,
        },
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
  readProjectFile,
  writeProjectFile,
} from "../../claude-session/identity-artifact-reader.js";
// Phase 117 M8 fix (2026-09-18): import the mocked databaseLogger so
// null-registry tests can assert the warning is logged.
import { databaseLogger } from "../../utils/logger.js";
// Phase 130: auto-tag path helpers.
import {
  isHostMultiUser,
  getUsernameForUserId,
} from "../../utils/host-user-counter.js";

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
  // Phase 117 M8 fix (2026-09-18): reset the null-registry flag between
  // tests so a null-registry test doesn't leak into subsequent tests.
  mockRegistryIsNull = false;

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
  (readProjectFile as Mock).mockResolvedValue({ markdown: "" });
  (writeProjectFile as Mock).mockResolvedValue({ markdown: "" });
  // Phase 130: reset auto-tag helpers each test — vi.clearAllMocks() clears
  // call history but preserves implementation, so a prior test's override
  // would leak into a later test's assertions.
  (isHostMultiUser as Mock).mockResolvedValue(false);
  (getUsernameForUserId as Mock).mockResolvedValue(null);

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

  // ---------------------------------------------------------------------------
  // Phase 130: per-user READ-side gate on GET /projects
  // ---------------------------------------------------------------------------
  it("Test 7a (Phase 130): projects with users → filtered to caller's visible set; response strips users field", async () => {
    (getUsernameForUserId as Mock).mockResolvedValue("alice");
    (listProjects as Mock).mockResolvedValue([
      { slug: "alpha", displayName: "Alpha", users: ["alice"] }, // visible
      { slug: "beta", displayName: "Beta", users: ["zoey"] }, // hidden
      { slug: "gamma", displayName: "Gamma", users: null }, // falls open
      { slug: "delta", displayName: "Delta", users: [] }, // falls open (empty)
    ]);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=5",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projects: [
        { slug: "alpha", displayName: "Alpha", archived: false },
        { slug: "gamma", displayName: "Gamma", archived: false },
        { slug: "delta", displayName: "Delta", archived: false },
      ],
    });
    // Response body MUST NOT leak the users field (Phase 129 HIGH-1 mirror).
    const projects = (res.body as { projects: Array<Record<string, unknown>> })
      .projects;
    for (const p of projects) {
      expect(p).not.toHaveProperty("users");
    }
  });

  it("Test 7b (Phase 130): username lookup returns null → gate disabled, all projects visible (fail-open)", async () => {
    (getUsernameForUserId as Mock).mockResolvedValue(null);
    (listProjects as Mock).mockResolvedValue([
      { slug: "alpha", displayName: "Alpha", users: ["alice"] },
      { slug: "beta", displayName: "Beta", users: ["zoey"] },
    ]);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=5",
    });

    expect(res.status).toBe(200);
    // Null caller = gate disabled = every project falls through.
    expect(res.body).toEqual({
      projects: [
        { slug: "alpha", displayName: "Alpha", archived: false },
        { slug: "beta", displayName: "Beta", archived: false },
      ],
    });
  });

  it("Test 7c (Phase 130): username lookup throws → gate disabled + warn logged (fail-open)", async () => {
    (getUsernameForUserId as Mock).mockRejectedValue(
      new Error("db unreachable"),
    );
    (listProjects as Mock).mockResolvedValue([
      { slug: "alpha", displayName: "Alpha", users: ["alice"] },
      { slug: "beta", displayName: "Beta", users: ["zoey"] },
    ]);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects?hostId=5",
    });

    expect(res.status).toBe(200);
    // Fail-open: BOTH visible even though caller shouldn't match either.
    expect((res.body as { projects: unknown[] }).projects).toHaveLength(2);
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /caller username lookup threw.*gate disabled.*db unreachable/,
      ),
    );
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
    // Phase 130: 4th arg is autoTagUsers — null on single-user hosts (the
    // default mock state) so this is byte-identical to the pre-130 shape at
    // the createProject write.
    expect(createProject).toHaveBeenCalledWith(
      null,
      "my-project",
      "My Project",
      null,
    );
    // publishProjectListChanged should fire exactly once after successful write.
    expect(mockPublishProjectListChanged).toHaveBeenCalledTimes(1);
    // First arg is the scoped hostId (string). Second arg is the projects
    // array with wire-event enrichment (hostId as string + hostname from
    // resolveHostById + archived).
    const call = mockPublishProjectListChanged.mock.calls[0];
    expect(call[0]).toBe("5");
    expect(Array.isArray(call[1])).toBe(true);
    expect(call[1]).toEqual([
      {
        slug: "my-project",
        displayName: "My Project",
        hostId: "5",
        hostname: "myhost",
        archived: false,
      },
    ]);
  });

  // Phase 117 M8 fix (2026-09-18): pre-fix, when getSubscriptionRegistry()
  // returned null (startup-timing bug in production; expected during
  // tests), the code silently no-op'd the publish. Post-fix, a warning
  // is logged so the failure is visible.
  it("Test 8b (M8 fix): null registry on create → publish silently skipped BUT a warning is logged", async () => {
    mockRegistryIsNull = true;

    (listProjects as Mock).mockResolvedValue([
      { slug: "my-project", displayName: "My Project" },
    ]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "My Project" },
    });

    // Create still succeeds — the null-registry is a startup-timing
    // bug, not a request failure.
    expect(res.status).toBe(200);
    expect(createProject).toHaveBeenCalledTimes(1);
    // publishProjectListChanged CANNOT be called (registry is null).
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
    // M8 regression: a warning MUST be logged so the failure is visible.
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /subscription registry not initialized.*hostId=5.*slug=my-project.*op=create/,
      ),
    );
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

  // ---------------------------------------------------------------------------
  // Phase 130: auto-tag creator on multi-user hosts
  //
  // Mirror of Phase 129 roles-create auto-tag tests. Single-user hosts stay
  // silent (byte-identical to pre-130 write); multi-user hosts get the
  // creator's Skynet username written into the frontmatter users list. Fail-
  // open on lookup failure — never a wrong-user tag.
  // ---------------------------------------------------------------------------
  it("Test 12a (Phase 130): multi-user host + username resolvable → users=[creator] passed to createProject", async () => {
    (isHostMultiUser as Mock).mockResolvedValue(true);
    (getUsernameForUserId as Mock).mockResolvedValue("alice");
    (listProjects as Mock).mockResolvedValue([
      { slug: "my-project", displayName: "My Project" },
    ]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "My Project" },
    });

    expect(res.status).toBe(200);
    expect(createProject).toHaveBeenCalledWith(
      null,
      "my-project",
      "My Project",
      ["alice"],
    );
    // Auto-tag success log should have fired.
    expect(databaseLogger.info).toHaveBeenCalledWith(
      expect.stringMatching(
        /auto-tagged creator on multi-user host.*hostId=5.*slug=my-project.*creatorUsername=alice/,
      ),
    );
  });

  it("Test 12b (Phase 130): single-user host → users=null passed (byte-identical to pre-130)", async () => {
    // Default mock is single-user + null username — assert the explicit null.
    (listProjects as Mock).mockResolvedValue([
      { slug: "my-project", displayName: "My Project" },
    ]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "My Project" },
    });

    expect(res.status).toBe(200);
    expect(createProject).toHaveBeenCalledWith(
      null,
      "my-project",
      "My Project",
      null,
    );
    // getUsernameForUserId MUST NOT be called on a single-user host (avoid
    // the DB round-trip when auto-tag can't apply).
    expect(getUsernameForUserId).not.toHaveBeenCalled();
  });

  it("Test 12c (Phase 130): multi-user host + username lookup returns null → users=null + warn logged (fail-open, no wrong-user tag)", async () => {
    (isHostMultiUser as Mock).mockResolvedValue(true);
    (getUsernameForUserId as Mock).mockResolvedValue(null);
    (listProjects as Mock).mockResolvedValue([
      { slug: "my-project", displayName: "My Project" },
    ]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "My Project" },
    });

    expect(res.status).toBe(200);
    // Create still succeeds, but with no auto-tag — file falls open per D-3.
    expect(createProject).toHaveBeenCalledWith(
      null,
      "my-project",
      "My Project",
      null,
    );
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /username lookup failed.*auto-tag skipped.*hostId=5.*slug=my-project/,
      ),
    );
  });

  it("Test 12d (Phase 130): isHostMultiUser throws → users=null + warn logged (fail-open on probe error)", async () => {
    (isHostMultiUser as Mock).mockRejectedValue(new Error("db probe failed"));
    (listProjects as Mock).mockResolvedValue([
      { slug: "my-project", displayName: "My Project" },
    ]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects",
      body: { hostId: 5, displayName: "My Project" },
    });

    // Create MUST succeed — a multi-user probe failure MUST NOT block the
    // create (a wrongly-blocked create is worse than a wrongly-open project).
    expect(res.status).toBe(200);
    expect(createProject).toHaveBeenCalledWith(
      null,
      "my-project",
      "My Project",
      null,
    );
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /isHostMultiUser probe failed.*auto-tag skipped.*hostId=5.*slug=my-project.*db probe failed/,
      ),
    );
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
    // Post-archive, the enriched wire event is scoped to this hostId and
    // carries the current (post-archive) list — empty in this test since
    // the only project was just archived.
    const call = mockPublishProjectListChanged.mock.calls[0];
    expect(call[0]).toBe("5");
    expect(call[1]).toEqual([]);
  });

  // Phase 117 M8 fix (2026-09-18): null-registry on archive path also logs.
  it("Test 13b (M8 fix): null registry on archive → publish silently skipped BUT a warning is logged", async () => {
    mockRegistryIsNull = true;
    (listProjects as Mock).mockResolvedValue([]);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/projects/my-project/archive",
      body: { hostId: 5 },
    });

    // Archive still succeeds.
    expect(res.status).toBe(200);
    expect(archiveProject).toHaveBeenCalledTimes(1);
    // No publish (registry null).
    expect(mockPublishProjectListChanged).not.toHaveBeenCalled();
    // M8 regression: warning logged.
    expect(databaseLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /subscription registry not initialized.*hostId=5.*slug=my-project.*op=archive/,
      ),
    );
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
// GET /projects/:slug/file
// ===========================================================================

describe("GET /projects/:slug/file", () => {
  it("Test F1: happy LOCAL → 200 { markdown } from readProjectFile(null, slug); no SSH", async () => {
    (readProjectFile as Mock).mockResolvedValue({
      markdown: "---\ndisplayName: 'Alpha'\n---\nbody",
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects/alpha/file?hostId=5",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      markdown: "---\ndisplayName: 'Alpha'\n---\nbody",
    });
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(readProjectFile).toHaveBeenCalledTimes(1);
    expect(readProjectFile).toHaveBeenCalledWith(null, "alpha");
  });

  it("Test F2: happy REMOTE → 200 with SSH conn passed; conn.end() in finally", async () => {
    (readProjectFile as Mock).mockResolvedValue({ markdown: "body" });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects/alpha/file?hostId=7",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ markdown: "body" });
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(readProjectFile).toHaveBeenCalledWith(stubConn, "alpha");
    expect(stubConn.end).toHaveBeenCalled();
  });

  it("Test F3: invalid slug — 'Alpha' → 400 before any I/O", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects/Alpha/file?hostId=5",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/slug/);
    expect(readProjectFile).not.toHaveBeenCalled();
  });

  it("Test F4: missing hostId → 400 before any I/O", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects/alpha/file",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(readProjectFile).not.toHaveBeenCalled();
  });

  it("Test F5: unknown host → 404 (cross-user probe defense T-117-04-01)", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects/alpha/file?hostId=99",
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    expect(readProjectFile).not.toHaveBeenCalled();
  });

  it("Test F6: readProjectFile throws → 500 generic (no err.message leak)", async () => {
    (readProjectFile as Mock).mockRejectedValue(
      new Error("EACCES: /private/fs/path leaked — sensitive info to caller"),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/projects/alpha/file?hostId=5",
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to read project file" });
    expect(JSON.stringify(res.body)).not.toContain("EACCES");
    expect(JSON.stringify(res.body)).not.toContain("sensitive info");
  });
});

// ===========================================================================
// PUT /projects/:slug/file
// ===========================================================================

describe("PUT /projects/:slug/file", () => {
  it("Test G1: happy LOCAL → 200 { markdown } from writeProjectFile(null, slug, contents)", async () => {
    (writeProjectFile as Mock).mockResolvedValue({ markdown: "new body" });

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/projects/alpha/file",
      body: { hostId: 5, contents: "new body" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ markdown: "new body" });
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    expect(writeProjectFile).toHaveBeenCalledWith(null, "alpha", "new body");
  });

  it("Test G2: happy REMOTE → 200 with SSH conn passed; conn.end() in finally", async () => {
    (writeProjectFile as Mock).mockResolvedValue({ markdown: "body" });

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/projects/alpha/file",
      body: { hostId: 7, contents: "body" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ markdown: "body" });
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(writeProjectFile).toHaveBeenCalledWith(stubConn, "alpha", "body");
    expect(stubConn.end).toHaveBeenCalled();
  });

  it("Test G3: invalid slug — 'Alpha' → 400 before any I/O", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/projects/Alpha/file",
      body: { hostId: 5, contents: "body" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/slug/);
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("Test G4: missing contents → 400 before any I/O", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/projects/alpha/file",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/contents/);
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("Test G5: non-string contents → 400 before any I/O", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/projects/alpha/file",
      body: { hostId: 5, contents: 123 },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/contents/);
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("Test G6: unknown host → 404", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/projects/alpha/file",
      body: { hostId: 99, contents: "body" },
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("Test G7: writeProjectFile throws → 500 generic (no err.message leak)", async () => {
    (writeProjectFile as Mock).mockRejectedValue(
      new Error("ENOENT: /host/private/path leaked — sensitive info"),
    );

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/projects/alpha/file",
      body: { hostId: 5, contents: "body" },
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to write project file" });
    expect(JSON.stringify(res.body)).not.toContain("ENOENT");
    expect(JSON.stringify(res.body)).not.toContain("sensitive info");
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
