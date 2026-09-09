/**
 * Phase 90 Plan 90-02 (D-08.2 — planner picks `GET /roles/:name/avatar?hostId=<n>`):
 * Tests for the role-avatar-serve endpoint.
 *
 * Byte-shape mirror of the identity-avatar-serve endpoint (identities.ts:767-870),
 * scoped to role addressing. Reference test scaffold:
 * identity-avatar-batch.test.ts (bare Express app + node:http request + vi.mock
 * of collaborators).
 *
 * Test coverage (10 cases — plan spec A-J):
 *   A: happy path, remote host   — 200 with role's avatar bytes + Content-Type
 *   B: happy path, local host    — conn=null threaded through readers
 *   C: role has no frontmatter avatar — 404 { error: "no avatar" }
 *   D: frontmatter avatar names a file, but the sibling is missing — 404
 *   E: invalid role name (path traversal via `..`) — 400 BEFORE any SSH work
 *   F: missing hostId query — 400
 *   G: invalid hostId query — 400
 *   H: host resolver returns null — 502 { error: "host not resolvable" }
 *      (Phase 90 Plan 90-10 LOW cleanup: differentiated from SSH-connect-throw
 *      "host unreachable" so debugging picks the right rabbit hole.)
 *   I: URL-encoded path traversal (%2E%2E%2F) — 400 (Express decodes → fails
 *      ROLE_NAME_PATTERN before SSH; STRIDE T-22-02-02 parallel).
 *   J: readRoleFileByName throws — silent-fallback to 404 (mirrors identities.ts:846-848).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — same pattern as identity-avatar-batch.test.ts
// ---------------------------------------------------------------------------

let mockUserId: string | null = "user-1";

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
            return res.status(401).json({ error: "Missing authentication token" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Host resolver / SSH mocks
// ---------------------------------------------------------------------------

let mockResolvedHost: unknown = { id: 3, host: "t1000", user: "user-1" };
let mockResolveShouldThrow = false;

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(async () => {
    if (mockResolveShouldThrow) throw new Error("resolver blew up");
    return mockResolvedHost;
  }),
}));

let mockConnectShouldThrow = false;
// Sentinel conn object — passed through to reader mocks so tests can assert
// "reader was called with a non-null conn" (remote branch) vs
// "reader was called with null" (local branch).
const MOCK_CONN = { __mock: "ssh-conn", end: vi.fn() };

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(async () => {
    if (mockConnectShouldThrow) throw new Error("connect blew up");
    return MOCK_CONN;
  }),
}));

// ---------------------------------------------------------------------------
// identity-artifact-reader mock — controls per-test what
// readRoleFileByName / readAvatarSiblingFileByRole / isLocalHostId return.
// ---------------------------------------------------------------------------

type MockCosmetics = { avatar?: string };
type MockAvatarRead = { bytes: Buffer; mime: string; ext: string } | null;

let mockIsLocal = false;
let mockReadRoleFile: (conn: unknown, roleName: string) => Promise<{ markdown: string }> =
  async () => ({ markdown: "---\navatar: box-maintainer.webp\n---\n" });
let mockExtractCosmetics: (md: string) => MockCosmetics = () => ({
  avatar: "box-maintainer.webp",
});
let mockReadAvatarByRole: (
  conn: unknown,
  roleName: string,
  avatarFilename: string,
) => Promise<MockAvatarRead> = async () => ({
  bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  mime: "image/webp",
  ext: "webp",
});

// Recorded calls — asserted per-test.
const recordedRoleReadCalls: Array<{ conn: unknown; roleName: string }> = [];
const recordedAvatarReadCalls: Array<{
  conn: unknown;
  roleName: string;
  avatarFilename: string;
}> = [];

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: (hostId: number | undefined) => {
    // Read runtime flag; tests toggle via mockIsLocal.
    return mockIsLocal && hostId !== undefined;
  },
  readRoleFileByName: (conn: unknown, roleName: string) => {
    recordedRoleReadCalls.push({ conn, roleName });
    return mockReadRoleFile(conn, roleName);
  },
  extractCosmeticsFromFrontmatter: (markdown: string) => mockExtractCosmetics(markdown),
  readAvatarSiblingFileByRole: (
    conn: unknown,
    roleName: string,
    avatarFilename: string,
  ) => {
    recordedAvatarReadCalls.push({ conn, roleName, avatarFilename });
    return mockReadAvatarByRole(conn, roleName, avatarFilename);
  },
  AVATAR_MIME_FROM_EXT: {
    webp: "image/webp",
    png: "image/png",
    jpg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
  },
}));

// Silence sshLogger noise from the route under test.
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
  databaseLogger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: { method: string; path: string },
): Promise<{ status: number; body: unknown; rawBuffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const contentType = String(res.headers["content-type"] ?? "");
          let parsed: unknown;
          if (contentType.includes("application/json")) {
            try {
              parsed = JSON.parse(raw.toString());
            } catch {
              parsed = raw.toString();
            }
          } else {
            parsed = raw;
          }
          resolve({
            status: res.statusCode ?? 0,
            body: parsed,
            rawBuffer: raw,
            contentType,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;

async function startServer(): Promise<http.Server> {
  const mod = await import("./roles.js");
  const router = mod.default;
  const app = express();
  app.use("/roles", router);
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}

beforeEach(async () => {
  mockUserId = "user-1";
  mockResolvedHost = { id: 3, host: "t1000", user: "user-1" };
  mockResolveShouldThrow = false;
  mockConnectShouldThrow = false;
  mockIsLocal = false;
  recordedRoleReadCalls.length = 0;
  recordedAvatarReadCalls.length = 0;
  // Reset reader defaults to happy-path shape.
  mockReadRoleFile = async () => ({ markdown: "---\navatar: box-maintainer.webp\n---\n" });
  mockExtractCosmetics = () => ({ avatar: "box-maintainer.webp" });
  mockReadAvatarByRole = async () => ({
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mime: "image/webp",
    ext: "webp",
  });
  MOCK_CONN.end.mockClear?.();
  server = await startServer();
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Test A: happy path, remote host
// ---------------------------------------------------------------------------

describe("Phase 90 Plan 90-02: GET /roles/:name/avatar", () => {
  it("A: happy path (remote) — 200 with role avatar bytes + Content-Type", async () => {
    const canned = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    mockReadAvatarByRole = async () => ({ bytes: canned, mime: "image/webp", ext: "webp" });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/box-maintainer/avatar?hostId=3",
    });

    expect(res.status).toBe(200);
    expect(res.contentType).toContain("image/webp");
    expect(Buffer.compare(res.rawBuffer, canned)).toBe(0);

    // Confirm remote branch: role read + avatar read received the SSH conn (non-null).
    expect(recordedRoleReadCalls).toHaveLength(1);
    expect(recordedRoleReadCalls[0].conn).toBe(MOCK_CONN);
    expect(recordedRoleReadCalls[0].roleName).toBe("box-maintainer");
    expect(recordedAvatarReadCalls).toHaveLength(1);
    expect(recordedAvatarReadCalls[0].conn).toBe(MOCK_CONN);
    expect(recordedAvatarReadCalls[0].roleName).toBe("box-maintainer");
    expect(recordedAvatarReadCalls[0].avatarFilename).toBe("box-maintainer.webp");
  });

  // -------------------------------------------------------------------------
  // Test B: happy path, local host
  // -------------------------------------------------------------------------

  it("B: happy path (local) — readers called with conn=null", async () => {
    mockIsLocal = true;
    const canned = Buffer.from([9, 9, 9]);
    mockReadAvatarByRole = async () => ({ bytes: canned, mime: "image/png", ext: "png" });
    mockExtractCosmetics = () => ({ avatar: "box-maintainer.png" });
    mockReadRoleFile = async () => ({ markdown: "---\navatar: box-maintainer.png\n---\n" });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/box-maintainer/avatar?hostId=1",
    });

    expect(res.status).toBe(200);
    expect(res.contentType).toContain("image/png");
    expect(Buffer.compare(res.rawBuffer, canned)).toBe(0);

    expect(recordedRoleReadCalls).toHaveLength(1);
    expect(recordedRoleReadCalls[0].conn).toBeNull();
    expect(recordedAvatarReadCalls).toHaveLength(1);
    expect(recordedAvatarReadCalls[0].conn).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test C: no frontmatter avatar → 404
  // -------------------------------------------------------------------------

  it("C: role file has no `avatar:` frontmatter → 404 { error: 'no avatar' }", async () => {
    mockExtractCosmetics = () => ({}); // no avatar field
    mockReadRoleFile = async () => ({ markdown: "# Role\nsome content, no frontmatter avatar\n" });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/box-maintainer/avatar?hostId=3",
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("no avatar");
    // Never even attempted to read the avatar sibling.
    expect(recordedAvatarReadCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test D: frontmatter names avatar file, but file missing → 404
  // -------------------------------------------------------------------------

  it("D: frontmatter names avatar but sibling file is missing → 404", async () => {
    mockReadAvatarByRole = async () => null;

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/box-maintainer/avatar?hostId=3",
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("no avatar");
  });

  // -------------------------------------------------------------------------
  // Test E: invalid role name (raw `..`) — 400 BEFORE any SSH work
  // -------------------------------------------------------------------------

  it("E: role name failing ROLE_NAME_PATTERN → 400 before SSH work", async () => {
    // We can't send a raw `..` in the URL path — most routers reject it at
    // the router level. But a name like "UPPERCASE_INVALID" (fails
    // /^[a-z0-9-]+$/) exercises the same gate.
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/UPPERCASE_INVALID/avatar?hostId=3",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/name must match/i);
    // Never reached SSH.
    expect(recordedRoleReadCalls).toHaveLength(0);
    expect(recordedAvatarReadCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test F: missing hostId query → 400
  // -------------------------------------------------------------------------

  it("F: missing hostId query → 400", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/box-maintainer/avatar",
    });

    expect(res.status).toBe(400);
    expect(recordedRoleReadCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test G: invalid hostId (non-integer) → 400
  // -------------------------------------------------------------------------

  it("G: invalid hostId (non-integer string) → 400", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/box-maintainer/avatar?hostId=abc",
    });

    expect(res.status).toBe(400);
    expect(recordedRoleReadCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test H: host resolver returns null → 502
  // -------------------------------------------------------------------------

  it("H: host resolver returns null → 502 'host not resolvable'", async () => {
    // Phase 90 Plan 90-10 LOW cleanup 2: resolveHostById returning null is now
    // distinct from an SSH-connect-throw. Both are 502 but with different
    // bodies so a future observer can distinguish "host doesn't exist / user
    // doesn't own it" from "we can't reach the host right now".
    mockResolvedHost = null;

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/box-maintainer/avatar?hostId=3",
    });

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toMatch(/host not resolvable/i);
    expect(recordedRoleReadCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test I: URL-encoded path-traversal — decoded to `..` → fails
  //        ROLE_NAME_PATTERN → 400 before any SSH work.
  //        STRIDE T-22-02-02 parallel: the router MUST NOT let a decoded
  //        `../` reach either the role reader or the avatar reader.
  // -------------------------------------------------------------------------

  it("I: URL-encoded traversal in :name → 400 before SSH (T-22-02-02 parallel)", async () => {
    // %2E%2E%2Fsecret decodes to `../secret` — Express decodes params by
    // default, so req.params.name will contain literal `../secret`, which
    // fails the kebab-case pattern.
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/%2E%2E%2Fsecret/avatar?hostId=3",
    });

    expect(res.status).toBe(400);
    expect(recordedRoleReadCalls).toHaveLength(0);
    expect(recordedAvatarReadCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test J: readRoleFileByName rejects → caught → 404 (silent fallback)
  // -------------------------------------------------------------------------

  it("J: readRoleFileByName throws → caught → 404 { error: 'no avatar' }", async () => {
    mockReadRoleFile = async () => {
      throw new Error("ssh exec blew up");
    };

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles/box-maintainer/avatar?hostId=3",
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("no avatar");
    // Avatar read never reached (short-circuited by the caught throw).
    expect(recordedAvatarReadCalls).toHaveLength(0);
  });
});
