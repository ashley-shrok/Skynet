/**
 * Phase 117 Plan 117-07 Task 1: Tests for the relay-room-project-tags-list
 * route — GET /relay-rooms/project-tags?hostId=<n>.
 *
 * Boot-time enumerator that walks the caller's Matrix rooms and returns the
 * subset that carry a `u.project.<slug>` account_data tag, so the frontend
 * can hydrate `roomProjectAssignments` at AppShell mount time (Fix 1 gate —
 * relay-room hydration is NOT deferred per D-05 two-carrier membership).
 *
 * Response shape: { assignments: Array<{roomId: string, slug: string}> }
 *
 * Test coverage (4+ per plan behavior block):
 *   1: Happy path — two joined rooms, one has u.project.alpha tag → assignments = [{roomId, slug: "alpha"}].
 *   2: Empty rooms — getUserJoinedRooms returns [] → 200 with assignments = [].
 *   3: Unknown/cross-user hostId → 404 (host isolation gate).
 *   4: Room with getRoomTags AdminErr is skipped (logged, not fatal — partial
 *      hydration is better than none).
 *   5: Unauth (no JWT) → 401.
 *   6: users.mxid absent → 403 defense.
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

// Mute logger.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock matrix-room-tag-client (getRoomTags) + matrix-admin-client
// (getUserJoinedRooms) + resolveHostById + db users.mxid lookup.
// ---------------------------------------------------------------------------

vi.mock("../../matrix/matrix-room-tag-client.js", () => ({
  getRoomTags: vi.fn(),
}));

vi.mock("../../matrix/matrix-admin-client.js", () => ({
  getUserJoinedRooms: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// db users.mxid lookup — same pattern as relay-room-project-tag.test.ts.
const mockUserMxidByUserId = new Map<string, string | null>();
vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const mxid = mockUserMxidByUserId.get(mockUserId ?? "") ?? null;
            return Promise.resolve([{ mxid }]);
          },
        }),
      }),
    }),
  },
}));
vi.mock("../db/schema.js", () => ({
  users: { id: "id", mxid: "mxid" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock declarations
// ---------------------------------------------------------------------------

import { getRoomTags } from "../../matrix/matrix-room-tag-client.js";
import { getUserJoinedRooms } from "../../matrix/matrix-admin-client.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

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
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
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
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Import router under test AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router from "./relay-room-project-tags-list.js";

let server: http.Server;

const CALLER_MXID = "@ash:t1000.taild9b663.ts.net";
const ROOM_A = "!aaa:t1000.taild9b663.ts.net";
const ROOM_B = "!bbb:t1000.taild9b663.ts.net";

beforeEach(() => {
  vi.clearAllMocks();
  mockUserMxidByUserId.clear();
  mockUserMxidByUserId.set("1", CALLER_MXID);
  mockUserId = "1";

  (resolveHostById as Mock).mockResolvedValue({ id: 1, name: "t1000" });

  // Rebuild app per test.
  const app = express();
  app.use(express.json());
  app.use("/relay-rooms", router);
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

describe("GET /relay-rooms/project-tags", () => {
  // Test 1: happy path — one of two rooms carries u.project.alpha
  it("Test 1: two joined rooms, one has u.project.alpha → assignments has one entry", async () => {
    (getUserJoinedRooms as Mock).mockResolvedValue({
      ok: true,
      roomIds: [ROOM_A, ROOM_B],
    });
    (getRoomTags as Mock).mockImplementation(async (_mxid: string, roomId: string) => {
      if (roomId === ROOM_A) {
        return { ok: true, tags: { "u.project.alpha": {}, "m.favourite": {} } };
      }
      return { ok: true, tags: {} };
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/relay-rooms/project-tags?hostId=1",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      assignments: [{ roomId: ROOM_A, slug: "alpha" }],
    });
  });

  // Test 2: empty rooms
  it("Test 2: no joined rooms → assignments = []", async () => {
    (getUserJoinedRooms as Mock).mockResolvedValue({ ok: true, roomIds: [] });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/relay-rooms/project-tags?hostId=1",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ assignments: [] });
    // No per-room tag fetches when no rooms.
    expect(getRoomTags).not.toHaveBeenCalled();
  });

  // Test 3: cross-user hostId → 404
  it("Test 3: unknown/cross-user hostId → 404 (host isolation)", async () => {
    (resolveHostById as Mock).mockResolvedValue(null);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/relay-rooms/project-tags?hostId=999",
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/host/i);
    expect(getUserJoinedRooms).not.toHaveBeenCalled();
  });

  // Test 4: per-room AdminErr skipped, partial hydration returned
  it("Test 4: a room whose getRoomTags returns AdminErr is skipped; other rooms still surface", async () => {
    (getUserJoinedRooms as Mock).mockResolvedValue({
      ok: true,
      roomIds: [ROOM_A, ROOM_B],
    });
    (getRoomTags as Mock).mockImplementation(async (_mxid: string, roomId: string) => {
      if (roomId === ROOM_A) {
        return { ok: false, status: 500, error: "matrix_room_tag_non_2xx" };
      }
      return { ok: true, tags: { "u.project.beta": {} } };
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/relay-rooms/project-tags?hostId=1",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      assignments: [{ roomId: ROOM_B, slug: "beta" }],
    });
  });

  // Test 5: unauth → 401
  it("Test 5: unauth (no JWT) → 401", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "GET",
      path: "/relay-rooms/project-tags?hostId=1",
    });

    expect(res.status).toBe(401);
    expect(getUserJoinedRooms).not.toHaveBeenCalled();
  });

  // Test 6: legacy user without mxid → 403 defense
  it("Test 6: authenticated user has no mxid on record → 403 (defense holds)", async () => {
    mockUserMxidByUserId.set("1", null);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/relay-rooms/project-tags?hostId=1",
    });

    expect(res.status).toBe(403);
    expect(getUserJoinedRooms).not.toHaveBeenCalled();
  });
});
