/**
 * Tests for POST /identities/:key/unarchive (Phase 143 Plan 143-04).
 *
 * Tests exercise the route via a bare Express app + Node's built-in http module
 * (mirrors apps-archive.test.ts / role-archive.test.ts pattern).
 *
 * Auth middleware is mocked. All I/O primitives (writeIdentityArchiveFile,
 * resolveHostById, connectOneShot, isLocalHostId, fs.access, python3 execFile,
 * execCommand) are mocked so tests exercise every branch without real disk or SSH.
 *
 * Test coverage:
 *   1:  Happy LOCAL — all three preconditions pass, writer called with correct args → 200 { ok: true }
 *   2:  archive_not_found LOCAL — archived folder absent → 409 { reason: "archive_not_found" }; writer NOT called
 *   3:  name_collision LOCAL — live folder exists → 409 { reason: "name_collision" }; writer NOT called
 *   4:  missing_roles LOCAL (one role archived) → 409 { reason: "missing_roles", missingRoles: ["ops-oncall"] }; writer NOT called
 *   5:  missing_roles LOCAL (both roles archived) → missingRoles sorted with both names; writer NOT called
 *   6:  Idempotent success — writer called twice → 200 both times (no error on pre-existing sentinel)
 *   7:  401 unauthenticated
 *   8:  400 missing hostId
 *   9:  400 malformed key (traversal attempt)
 *   10: 504 SSH connect failure REMOTE (not a precondition failure)
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
// Hoisted mock variables — must be declared with vi.hoisted so they are
// available inside vi.mock() factories (which are hoisted above regular code).
// ---------------------------------------------------------------------------

// mockFsAccess: mocks node:fs/promises default.access
// mockExecFile: mocks node:child_process execFile
//
// The route's execFileAsync is a manual Promise wrapper around execFile (not
// util.promisify) so the mock just needs to call its callback(err, stdout, stderr).
const { mockFsAccess, mockExecFile } = vi.hoisted(() => ({
  mockFsAccess: vi.fn().mockResolvedValue(undefined),
  mockExecFile: vi.fn(),
}));

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
// Mock SSH primitives + identity-artifact-reader
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// IDENTITY_KEY_RE is a real constant — pass through verbatim.
// isLocalHostId and getLocalIdentitiesRoot are functions we control per test.
vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  getLocalIdentitiesRoot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock archive-tree primitives
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/per-identity-archive-file.js", () => ({
  writeIdentityArchiveFile: vi.fn(),
}));

vi.mock("../../claude-session/list-archived-identity-keys.js", () => ({
  getLocalArchivedIdentitiesRoot: vi.fn(),
}));

vi.mock("../../claude-session/per-role-archive-file.js", () => ({
  getLocalArchivedRolesRoot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock node:fs/promises (archive-exists + name-collision + role-exists checks)
// Provide BOTH named export AND default to cover both import styles.
// Initial implementation resolves immediately (happy-path default); tests
// that need failures call .mockImplementation() to override.
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  access: mockFsAccess,
  default: {
    access: mockFsAccess,
  },
}));

// ---------------------------------------------------------------------------
// Mock node:child_process execFile (python3 role parse)
// The route uses promisify(execFile). We mock execFile as a callback-style
// function; promisify wraps it correctly.
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

// ---------------------------------------------------------------------------
// Mock execCommand for REMOTE path SSH calls
// ---------------------------------------------------------------------------

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  isLocalHostId,
  getLocalIdentitiesRoot,
} from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityArchiveFile } from "../../claude-session/per-identity-archive-file.js";
import { getLocalArchivedIdentitiesRoot } from "../../claude-session/list-archived-identity-keys.js";
import { getLocalArchivedRolesRoot } from "../../claude-session/per-role-archive-file.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { databaseLogger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Helper: set up execFile mock to return a specific stdout for python3 calls
// ---------------------------------------------------------------------------

type ExecFileCallback = (
  err: Error | null,
  stdout: string,
  stderr: string,
) => void;

function mockPython3Returns(jsonOutput: string): void {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      callback: ExecFileCallback,
    ) => {
      callback(null, jsonOutput, "");
    },
  );
}

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
// Stubs
// ---------------------------------------------------------------------------

const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

const stubHost = {
  id: 42,
  ip: "10.0.0.42",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// Fake roots for LOCAL tests — deliberately non-overlapping paths so
// startsWith() checks don't produce false positives across roots.
const FAKE_ARCHIVE_ROOT = "/tmp/test-identities-archive";
const FAKE_LIVE_ROOT = "/tmp/test-identities-live";
const FAKE_ROLES_ARCHIVE_ROOT = "/tmp/test-roles-archive";

// ---------------------------------------------------------------------------
// Import the router under test — AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router from "./identity-unarchive.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Reset module-scope mocks that vi.clearAllMocks doesn't automatically
  // reset implementations for (they live outside vi.mock() factories).
  mockFsAccess.mockReset();
  mockExecFile.mockReset();

  // Default: user owns hostId 42 (local), 43 (remote); hostId 99 not owned
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 42 || hostId === 43) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  // Default: hostId 42 is local, 43 is remote
  (isLocalHostId as Mock).mockImplementation((hostId: number) => hostId === 42);

  // Default: SSH connect resolves to stubConn
  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default: writeIdentityArchiveFile succeeds
  (writeIdentityArchiveFile as Mock).mockResolvedValue(undefined);

  // Default: root helpers return fake paths
  (getLocalArchivedIdentitiesRoot as Mock).mockReturnValue(FAKE_ARCHIVE_ROOT);
  (getLocalIdentitiesRoot as Mock).mockReturnValue(FAKE_LIVE_ROOT);
  (getLocalArchivedRolesRoot as Mock).mockReturnValue(FAKE_ROLES_ARCHIVE_ROOT);


  // Default LOCAL fs.access behavior:
  //   - archive folder exists (no ENOENT on archive path)
  //   - identity.md exists (no ENOENT)
  //   - live folder does NOT exist (ENOENT on live path) → no collision
  //   - no roles archived (ENOENT on roles-archive path)
  mockFsAccess.mockImplementation((p: string) => {
    if (p.startsWith(FAKE_LIVE_ROOT)) {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return Promise.reject(err);
    }
    if (p.startsWith(FAKE_ROLES_ARCHIVE_ROOT)) {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return Promise.reject(err);
    }
    // FAKE_ARCHIVE_ROOT + identity.md + anything else → exists
    return Promise.resolve();
  });

  // Default: python3 returns empty roles [] (happy path — no roles to check)
  mockPython3Returns("[]");

  // Default: execCommand for REMOTE tests returns "yes"
  (execCommand as Mock).mockResolvedValue("yes\n");

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

describe("POST /identities/:key/unarchive", () => {
  // -------------------------------------------------------------------------
  // Test 1: Happy LOCAL path — all three preconditions pass
  // -------------------------------------------------------------------------

  it("Test 1: happy LOCAL → 200 { ok: true }; writeIdentityArchiveFile called with correct args; audit log fired", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Writer called with the sentinel in the archive tree
    expect(writeIdentityArchiveFile).toHaveBeenCalledTimes(1);
    expect(writeIdentityArchiveFile).toHaveBeenCalledWith(
      "wren",
      ".unarchive-requested",
      "",
      { hostId: 42, conn: null },
    );

    // LOCAL branch must not open an SSH connection
    expect(connectOneShot).not.toHaveBeenCalled();

    // Audit log
    const infoMock = databaseLogger.info as unknown as Mock;
    expect(infoMock).toHaveBeenCalled();
    const infoMsg = infoMock.mock.calls[0][0] as string;
    expect(infoMsg).toMatch(/identity unarchive requested/);
    expect(infoMsg).toMatch(/userId=/);
    expect(infoMsg).toMatch(/hostId=42/);
    expect(infoMsg).toMatch(/key=wren/);
  });

  // -------------------------------------------------------------------------
  // Test 2: archive_not_found LOCAL
  // -------------------------------------------------------------------------

  it("Test 2: archive folder absent LOCAL → 409 { reason: 'archive_not_found' }; writer NOT called", async () => {
    // Override: archive folder does NOT exist (even FAKE_ARCHIVE_ROOT paths reject)
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_ARCHIVE_ROOT)) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return Promise.reject(err);
      }
      return Promise.resolve();
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "archive_not_found" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: name_collision LOCAL
  // -------------------------------------------------------------------------

  it("Test 3: live folder exists LOCAL → 409 { reason: 'name_collision' }; writer NOT called", async () => {
    // Override: archive folder present, live folder ALSO present → collision
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_ARCHIVE_ROOT)) {
        return Promise.resolve(); // archive exists
      }
      if (p.startsWith(FAKE_LIVE_ROOT)) {
        return Promise.resolve(); // live folder ALSO exists → collision
      }
      return Promise.resolve();
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "name_collision" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: missing_roles LOCAL (one role still archived)
  // -------------------------------------------------------------------------

  it("Test 4: one role still archived → 409 { reason: 'missing_roles', missingRoles: ['ops-oncall'] }; writer NOT called", async () => {
    // python3 returns two roles; ops-oncall is still archived, researcher is live
    mockPython3Returns('["ops-oncall","researcher"]');

    // fs.access: archive folder present, no live collision,
    // ops-oncall IS in roles-archive, researcher is NOT
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_LIVE_ROOT)) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return Promise.reject(err); // no collision
      }
      if (p.startsWith(FAKE_ROLES_ARCHIVE_ROOT)) {
        if (p.endsWith("/ops-oncall")) {
          return Promise.resolve(); // ops-oncall still archived
        }
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return Promise.reject(err); // researcher not archived
      }
      // archive root + identity.md → present
      return Promise.resolve();
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      reason: "missing_roles",
      missingRoles: ["ops-oncall"],
    });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: missing_roles LOCAL (both roles archived) — sorted
  // -------------------------------------------------------------------------

  it("Test 5: both roles archived → missingRoles sorted with both; writer NOT called", async () => {
    // python3 returns two roles in reverse order to confirm sorting
    mockPython3Returns('["researcher","ops-oncall"]');

    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_LIVE_ROOT)) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return Promise.reject(err); // no collision
      }
      if (p.startsWith(FAKE_ROLES_ARCHIVE_ROOT)) {
        return Promise.resolve(); // both roles still archived
      }
      // archive root + identity.md → present
      return Promise.resolve();
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(409);
    const body = res.body as { reason: string; missingRoles: string[] };
    expect(body.reason).toBe("missing_roles");
    // Both roles present, sorted alphabetically
    expect(body.missingRoles).toEqual(["ops-oncall", "researcher"]);
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: Idempotent success — writer called twice succeeds both times
  // -------------------------------------------------------------------------

  it("Test 6: idempotent — two calls both return 200 (no error on pre-existing sentinel)", async () => {
    (writeIdentityArchiveFile as Mock).mockResolvedValue(undefined);

    const res1 = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 42 },
    });
    const res2 = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 42 },
    });

    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ ok: true });
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ ok: true });
    expect(writeIdentityArchiveFile).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Test 7: 401 unauthenticated
  // -------------------------------------------------------------------------

  it("Test 7: 401 without JWT; no downstream calls", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(401);
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 8: 400 missing hostId
  // -------------------------------------------------------------------------

  it("Test 8: 400 missing hostId", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: {},
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 9: 400 malformed key (fails IDENTITY_KEY_RE)
  // -------------------------------------------------------------------------

  it("Test 9: 400 uppercase key rejected by IDENTITY_KEY_RE (traversal-shape guard)", async () => {
    // IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/ — uppercase fails.
    // (Express normalizes actual path-traversal sequences like ../ before the handler
    // sees them; testing uppercase exercizes the regex gate directly.)
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/INVALID_KEY/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(
      /identity key must match/,
    );
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 10: 504 SSH connect failure REMOTE
  // -------------------------------------------------------------------------

  it("Test 10: REMOTE connectOneShot throws → 504 (not a precondition failure); writer NOT called", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/unarchive",
      body: { hostId: 43 },
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(writeIdentityArchiveFile).not.toHaveBeenCalled();
    // Must NOT be 409 — connect failure is infrastructure, not precondition
    expect(res.status).not.toBe(409);
  });
});
